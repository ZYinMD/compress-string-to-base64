// Exercise the browser-facing API with real compression streams, native gzip fixtures, and controlled FileReader events without adding runtime dependencies.
/*
 * Run npm test with Node 24 or later, using its built-in test runner, gzip implementation, and Web Streams without installing test dependencies.
 * FileReader is replaced by a test double, and native Base64 methods are enabled or disabled explicitly to exercise every route deterministically as Node gains browser APIs.
 * Damaged-gzip and injected stream failures run in a child process with strict unhandled-rejection handling so catching the public error cannot conceal ignored internal promises.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { base64ToString, stringToBase64 } from "../index.js";
import { arrayBufferToBase64, unzipToString, zipString } from "../modules.js";

const originalFileReader = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
const originalToBase64 = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "toBase64");
const originalFromBase64 = Object.getOwnPropertyDescriptor(Uint8Array, "fromBase64");

function setNativeBase64(toBase64, fromBase64) {
  Object.defineProperty(Uint8Array.prototype, "toBase64", { configurable: true, writable: true, value: toBase64 });
  Object.defineProperty(Uint8Array, "fromBase64", { configurable: true, writable: true, value: fromBase64 });
}

function restoreProperty(target, name, descriptor) {
  if (descriptor) Object.defineProperty(target, name, descriptor);
  else delete target[name];
}

function installFileReader(Reader) {
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    writable: true,
    value: Reader,
  });
}

class BrowserFileReader {
  result = null;
  error = null;

  readAsDataURL(blob) {
    blob.arrayBuffer().then(
      (bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload?.();
      },
      (error) => {
        this.error = error;
        this.onerror?.();
      },
    );
  }
}

beforeEach(function browserFileReader() {
  installFileReader(BrowserFileReader);
  // Exercise the fallback deterministically even when a future Node release ships the browser's native Base64 methods.
  setNativeBase64(undefined, undefined);
});

afterEach(function restoreFileReader() {
  restoreProperty(globalThis, "FileReader", originalFileReader);
  restoreProperty(Uint8Array.prototype, "toBase64", originalToBase64);
  restoreProperty(Uint8Array, "fromBase64", originalFromBase64);
});

for (const [name, input] of [
  ["empty strings", ""],
  ["ordinary ASCII", "An archive database can contain many video records."],
  ["Unicode and JSON escape sequences", JSON.stringify({
    greeting: "Hello 世界 ❤️ 👩🏽‍💻",
    description: "quotes: \" backslash: \\ newline:\n template: `${value}`",
  })],
]) {
  test(`round-trips ${name}`, async function roundTrip() {
    const encoded = await stringToBase64(input);
    assert.equal(await base64ToString(encoded), input);
  });
}

test("writes gzip-compatible Base64 that native zlib can decompress", async function nativeDecode() {
  const input = "Archive metadata: 视频, café, and escaped \\ paths.";
  const encoded = await stringToBase64(input);
  assert.equal(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"), input);
});

test("reads Base64 gzip fixtures produced independently by native zlib", async function nativeEncode() {
  const input = JSON.stringify({ schemaVersion: 7, qualities: { "123": "1080,hevc,2000000" } });
  assert.equal(await base64ToString(gzipSync(input).toString("base64")), input);
});

for (const nativeEncode of [false, true]) {
  for (const nativeDecode of [false, true]) {
    test(`gzip wire format interoperates with native encoding=${nativeEncode}, native decoding=${nativeDecode}`, async function codecCompatibility() {
      let encodedNatively = 0;
      let decodedNatively = 0;
      let fileReaderCalls = 0;
      installFileReader(class CountingFileReader extends BrowserFileReader {
        readAsDataURL(blob) {
          fileReaderCalls++;
          super.readAsDataURL(blob);
        }
      });
      setNativeBase64(
        nativeEncode ? function encodeBytes() {
          encodedNatively++;
          assert.ok(this instanceof Uint8Array);
          return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
        } : undefined,
        nativeDecode ? function decodeBytes(base64) {
          decodedNatively++;
          return new Uint8Array(Buffer.from(base64, "base64"));
        } : undefined,
      );
      const input = JSON.stringify({ text: "Native and fallback codecs preserve Unicode 世界 ❤️ and \\ escapes.", values: [0, 1, 2] });
      const encoded = await stringToBase64(input);
      assert.equal(gunzipSync(Buffer.from(encoded, "base64")).toString("utf8"), input);
      assert.equal(await base64ToString(encoded), input);
      assert.equal(await base64ToString(gzipSync(input).toString("base64")), input);
      assert.equal(encodedNatively, nativeEncode ? 1 : 0);
      assert.equal(decodedNatively, nativeDecode ? 2 : 0);
      assert.equal(fileReaderCalls, nativeEncode ? 0 : 1);
    });
  }
}

test("native Base64 decoding errors reach the caller without retrying the permissive fallback", async function nativeDecodeError() {
  const failure = new SyntaxError("The browser rejected malformed Base64.");
  setNativeBase64(undefined, function rejectBase64() { throw failure; });
  await assert.rejects(base64ToString("%%%"), (error) => error === failure);
});

test("native Base64 encoding failures reach the caller without starting FileReader", async function nativeEncodeError() {
  const failure = new Error("The native encoder failed.");
  setNativeBase64(function rejectEncoding() { throw failure; }, undefined);
  let fileReaderCalls = 0;
  installFileReader(class UnexpectedFileReader {
    constructor() { fileReaderCalls++; }
  });
  await assert.rejects(stringToBase64("The fallback must not hide native failures."), (error) => error === failure);
  assert.equal(fileReaderCalls, 0);
});

test("compression helpers accept a byte view with an offset without including surrounding bytes", async function byteView() {
  const input = "Only the selected bytes belong to the gzip payload. 世界";
  const compressed = new Uint8Array(await zipString(input));
  const surrounding = new Uint8Array(compressed.length + 20);
  surrounding.fill(0xff);
  surrounding.set(compressed, 7);
  assert.equal(await unzipToString(surrounding.subarray(7, 7 + compressed.length)), input);
});

test("round-trips a multi-megabyte input without getting stuck on stream backpressure", { timeout: 15_000 }, async function largeInput() {
  // Deterministic varied text keeps the compressed output larger than a stream's small internal queues.
  const bytes = new Uint8Array(2 * 1024 * 1024);
  let state = 0x12345678;
  for (let index = 0; index < bytes.length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = 32 + ((state >>> 0) % 95);
  }
  const input = new TextDecoder().decode(bytes);
  const encoded = await stringToBase64(input);
  assert.ok(Buffer.from(encoded, "base64").length > 1024 * 1024);
  assert.equal(await base64ToString(encoded), input);
});

test("damaged gzip rejects cleanly with native and fallback Base64 decoding", function damagedGzip() {
  // A separate process makes ignored stream-write rejections fatal even after the public API's rejection has been caught.
  const entry = new URL("../index.js", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import { setImmediate } from "node:timers/promises";
    import { gzipSync } from "node:zlib";
    import { base64ToString, stringToBase64 } from ${JSON.stringify(entry)};
    const valid = gzipSync("The complete gzip data includes its checksum and size.");
    const badChecksum = Buffer.from(valid);
    badChecksum[badChecksum.length - 8] ^= 0xff;
    for (const nativeDecode of [false, true]) {
      Object.defineProperty(Uint8Array, "fromBase64", {
        configurable: true,
        value: nativeDecode ? (base64) => new Uint8Array(Buffer.from(base64, "base64")) : undefined,
      });
      for (const damaged of [Buffer.from([0, 1, 2, 3]), valid.subarray(0, valid.length - 3), badChecksum]) {
        await assert.rejects(base64ToString(damaged.toString("base64")));
        await setImmediate();
        await setImmediate();
      }
    }
    globalThis.CompressionStream = class FailingCompressionStream {
      constructor() {
        const broken = new TransformStream({
          transform() { throw new Error("Compression failed."); },
        });
        this.readable = broken.readable;
        this.writable = broken.writable;
      }
    };
    await assert.rejects(stringToBase64("A compression failure must also reach only the caller."), /Compression failed/);
    await setImmediate();
    await setImmediate();
  `;
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("FileReader errors reject the public encoding promise", { timeout: 2_000 }, async function readerError() {
  const failure = new DOMException("The input could not be read.", "NotReadableError");
  installFileReader(class FailingFileReader {
    error = failure;
    readAsDataURL() {
      queueMicrotask(() => this.onerror?.());
    }
  });
  await assert.rejects(stringToBase64("This read will fail."), (error) => error === failure);
});

test("FileReader aborts reject rather than leaving encoding pending", { timeout: 2_000 }, async function readerAbort() {
  installFileReader(class AbortedFileReader {
    readAsDataURL() {
      queueMicrotask(() => this.onabort?.());
    }
  });
  await assert.rejects(stringToBase64("This read will be aborted."), { name: "AbortError" });
});

test("synchronous FileReader failures reject normally", async function readerThrows() {
  const failure = new Error("The browser could not start the read.");
  installFileReader(class ThrowingFileReader {
    readAsDataURL() {
      throw failure;
    }
  });
  await assert.rejects(arrayBufferToBase64(new ArrayBuffer(3)), (error) => error === failure);
});

for (const result of [null, "data:text/plain,not-a-base64-payload"]) {
  test(`unexpected FileReader result ${JSON.stringify(result)} rejects normally`, async function invalidReaderResult() {
    installFileReader(class UnexpectedFileReader {
      result = result;
      readAsDataURL() {
        queueMicrotask(() => this.onload?.());
      }
    });
    await assert.rejects(arrayBufferToBase64(new ArrayBuffer(3)));
  });
}
