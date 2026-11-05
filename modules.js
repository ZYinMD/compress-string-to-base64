// Feed buffered input through a transform while its output is consumed, so stream errors stay within the returned conversion promise.
function transformBytes(bytes, transform) {
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return input.pipeThrough(transform);
}

/**
 * compress a string to bytes using gzip
 * @param {string} string
 * @returns {Promise<ArrayBuffer>}
 */
export function zipString(string) {
  const byteArray = new TextEncoder().encode(string);
  const output = transformBytes(byteArray, new CompressionStream("gzip"));
  return new Response(output).arrayBuffer();
}

/**
 * unzip compressed bytes to string
 * @param {ArrayBufferLike} bytes
 * @returns {Promise<string>}
 */
export async function unzipToString(bytes) {
  const output = transformBytes(bytes, new DecompressionStream("gzip"));
  return new Response(output).text();
}

/** Convert an ArrayBuffer to Base64 using FileReader; browser performance comparisons are documented in bench/RESULTS.md.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
export async function arrayBufferToBase64(buffer) {
  const file = new File([buffer], "temp.bin", {
    type: "application/octet-stream",
  });
  return new Promise(function encodeBase64(resolve, reject) {
    const fileReader = new FileReader();
    fileReader.onload = function loaded() {
      const dataUrl = fileReader.result;
      const marker = ";base64,";
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:") || !dataUrl.includes(marker)) {
        reject(new Error("FileReader did not return a Base64 data URL."));
        return;
      }
      resolve(dataUrl.slice(dataUrl.indexOf(marker) + marker.length));
    };
    fileReader.onerror = function failed() {
      reject(fileReader.error ?? new Error("FileReader could not encode the data."));
    };
    fileReader.onabort = function aborted() {
      reject(new DOMException("Base64 encoding was aborted.", "AbortError"));
    };
    fileReader.readAsDataURL(file);
  });
}

/* the code below was copied from npm base64-arraybuffer: https://www.npmjs.com/package/base64-arraybuffer */

// Use a lookup table to find the index.
const lookup = typeof Uint8Array === "undefined" ? [] : new Uint8Array(256);
const chars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
for (let i = 0; i < chars.length; i++) {
  lookup[chars.charCodeAt(i)] = i;
}

/**
 * Decode Base64 directly into bytes using a lookup table, without an intermediate binary string.
 * @param {string} base64String
 */
export function decodeBase64(base64String) {
  let bufferLength = base64String.length * 0.75,
    len = base64String.length,
    i,
    p = 0,
    encoded1,
    encoded2,
    encoded3,
    encoded4;

  if (base64String[base64String.length - 1] === "=") {
    bufferLength--;
    if (base64String[base64String.length - 2] === "=") {
      bufferLength--;
    }
  }

  const arraybuffer = new ArrayBuffer(bufferLength),
    bytes = new Uint8Array(arraybuffer);

  for (i = 0; i < len; i += 4) {
    encoded1 = lookup[base64String.charCodeAt(i)];
    encoded2 = lookup[base64String.charCodeAt(i + 1)];
    encoded3 = lookup[base64String.charCodeAt(i + 2)];
    encoded4 = lookup[base64String.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }

  return arraybuffer;
}
