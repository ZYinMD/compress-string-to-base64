// Compare complete byte-to-Base64 and Base64-to-byte conversions in the browser, keeping loading and correctness checks outside the timed work.
/*
 * The server prepares read-only archive snapshots before this page runs, so NAS reads, wrapper extraction, gzip, and JSON parsing are excluded from the conversion timings.
 * Two warmup rounds precede seven measured rounds, with shuffled method order and fixed per-sample batches to reduce order bias and amortize very short conversions.
 * Full output equality is checked after each batch outside the timed interval, while output allocation and browser processing remain part of the measured conversion.
 * Keep the tab visible; results include browser details and every measured batch, and the server saves them as JSON for later aggregation.
 * Native codecs were fastest in the Chrome archive measurements in RESULTS.md; FileReader beat the tested older encoders, while lookup decoding was roughly tied with an optimized atob byte-copy loop.
 */
import { arrayBufferToBase64, decodeBase64 } from "/modules.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const warmups = 2;
const rounds = 7;
const seed = Number(new URL(location.href).searchParams.get("seed")) || 0x17345;
let randomState = seed;

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    const other = (randomState >>> 0) % (index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function encodeBtoa(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + 32768)));
  }
  return btoa(chunks.join(""));
}

// Join bounded chunks so a JavaScript encoder cannot defer flattening a large concatenated string until a later consumer uses it.
function encodeJavaScript(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const end = bytes.length - bytes.length % 3;
  for (let start = 0; start < end; start += 16383) {
    const parts = [];
    for (let index = start; index < Math.min(start + 16383, end); index += 3) {
      const value = bytes[index] * 65536 + bytes[index + 1] * 256 + bytes[index + 2];
      parts.push(alphabet[value >>> 18] + alphabet[value >>> 12 & 63] + alphabet[value >>> 6 & 63] + alphabet[value & 63]);
    }
    chunks.push(parts.join(""));
  }
  if (bytes.length % 3 === 1) {
    const value = bytes[end];
    chunks.push(alphabet[value >>> 2] + alphabet[(value & 3) << 4] + "==");
  } else if (bytes.length % 3 === 2) {
    const value = bytes[end] * 256 + bytes[end + 1];
    chunks.push(alphabet[value >>> 10] + alphabet[value >>> 4 & 63] + alphabet[(value & 15) << 2] + "=");
  }
  return chunks.join("");
}

function decodeAtobLoop(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function decodeAtobFrom(base64) {
  return Uint8Array.from(atob(base64), function byte(character) { return character.charCodeAt(0); }).buffer;
}

async function decodeFetch(base64) {
  return (await fetch("data:application/octet-stream;base64," + base64)).arrayBuffer();
}

const encoders = [
  { name: "FileReader (package)", run: arrayBufferToBase64 },
  { name: "btoa + chunked byte conversion", run: encodeBtoa },
  { name: "JavaScript lookup encoder (joined chunks)", run: encodeJavaScript },
];
const decoders = [
  { name: "JavaScript lookup decoder (package)", run: decodeBase64 },
  { name: "atob + preallocated byte loop", run: decodeAtobLoop },
  { name: "atob + Uint8Array.from callback", run: decodeAtobFrom },
  { name: "fetch(data URL) + arrayBuffer", run: decodeFetch },
];
if (typeof Uint8Array.prototype.toBase64 === "function") {
  encoders.push({ name: "Uint8Array.toBase64 (native)", run(buffer) { return new Uint8Array(buffer).toBase64(); } });
}
if (typeof Uint8Array.fromBase64 === "function") {
  decoders.push({ name: "Uint8Array.fromBase64 (native)", run(base64) { return Uint8Array.fromBase64(base64).buffer; } });
}

function verify(result, expected) {
  if (typeof expected === "string") {
    if (result !== expected) throw new Error("An encoder returned different Base64 data.");
    return;
  }
  const bytes = new Uint8Array(result);
  const reference = new Uint8Array(expected);
  if (bytes.length !== reference.length) throw new Error("A decoder returned a different byte count.");
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] !== reference[index]) throw new Error("A decoder returned different bytes.");
  }
}

function percentile(values, fraction) {
  const sorted = [...values].sort(function numeric(a, b) { return a - b; });
  const position = (sorted.length - 1) * fraction;
  const start = Math.floor(position);
  return sorted[start] + (sorted[Math.ceil(position)] - sorted[start]) * (position - start);
}

function showTable(label, direction, rows) {
  const heading = document.createElement("h2");
  heading.textContent = label + " — " + direction;
  const table = document.createElement("table");
  for (const row of [["Method", "Median ms", "p10–p90 ms"], ...rows.map(function cells(row) {
    return [row.method, row.medianMs.toFixed(3), row.p10Ms.toFixed(3) + "–" + row.p90Ms.toFixed(3)];
  })]) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    table.append(tr);
  }
  document.querySelector("#tables").append(heading, table);
}

async function runMethods(sample, direction, methods, input, expected) {
  const batch = Math.min(16, Math.max(1, Math.ceil(4 * 1024 * 1024 / sample.gzipBytes)));
  const timings = new Map(methods.map(function empty(method) { return [method.name, []]; }));
  for (let round = -warmups; round < rounds; round++) {
    for (const method of shuffle(methods)) {
      document.querySelector("#progress").textContent = `${sample.label}: ${direction}, ${method.name}, ${round < 0 ? "warmup" : "round " + (round + 1)} of ${rounds}`;
      await new Promise(function yieldToBrowser(resolve) { setTimeout(resolve, 0); });
      if (document.visibilityState !== "visible") throw new Error("The benchmark tab became hidden; rerun with it visible.");
      let result;
      const start = performance.now();
      for (let iteration = 0; iteration < batch; iteration++) result = await method.run(input);
      const elapsed = (performance.now() - start) / batch;
      if (document.visibilityState !== "visible") throw new Error("The benchmark tab became hidden during a conversion; rerun with it visible.");
      verify(result, expected);
      result = undefined;
      if (round >= 0) timings.get(method.name).push(elapsed);
    }
  }
  return methods.map(function summary(method) {
    const values = timings.get(method.name);
    return { method: method.name, batch, timingsMs: values, medianMs: percentile(values, .5), p10Ms: percentile(values, .1), p90Ms: percentile(values, .9) };
  });
}

async function main() {
  const manifest = await (await fetch("/api/samples")).json();
  const report = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    crossOriginIsolated,
    warmups,
    rounds,
    seed,
    serverEnvironment: manifest.environment,
    samples: [],
  };
  for (const sample of manifest.samples) {
    document.querySelector("#progress").textContent = "Loading " + sample.label;
    const [bytes, base64] = await Promise.all([
      fetch(`/api/samples/${sample.id}/bytes`).then(function body(response) { return response.arrayBuffer(); }),
      fetch(`/api/samples/${sample.id}/base64`).then(function body(response) { return response.text(); }),
    ]);
    const encoding = await runMethods(sample, "encode", encoders, bytes, base64);
    showTable(sample.label, "encode", encoding);
    const decoding = await runMethods(sample, "decode", decoders, base64, bytes);
    showTable(sample.label, "decode", decoding);
    report.samples.push({ ...sample, encoding, decoding });
  }
  const response = await fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
  if (!response.ok) throw new Error("Could not save benchmark results.");
  const saved = await response.json();
  document.querySelector("#progress").textContent = "Complete. Every method returned the expected result.";
  document.querySelector("#result").textContent = "Results saved: " + saved.path;
}

main().catch(function failed(error) {
  document.querySelector("#progress").textContent = "Benchmark failed.";
  document.querySelector("#result").textContent = error.stack;
});
