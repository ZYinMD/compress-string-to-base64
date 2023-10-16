/**
 * compress a string to bytes using gzip
 * @param {string} string
 * @returns {Promise<ArrayBuffer>}
 */
export function zipString(string) {
  const byteArray = new TextEncoder().encode(string);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(byteArray);
  writer.close();
  return new Response(cs.readable).arrayBuffer();
}

/**
 * unzip compressed bytes to string
 * @param {ArrayBufferLike} bytes
 * @returns {Promise<string>}
 */
export async function unzipToString(bytes) {
  const cs = new DecompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const arrayBuffer = await new Response(cs.readable).arrayBuffer();
  return new TextDecoder().decode(arrayBuffer);
}

/** convert arrayBuffer to base64 using the fileReader API, which is more performant than btoa as well as js implementation
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
export async function arrayBufferToBase64(buffer) {
  const file = new File([buffer], "temp.bin", {
    type: "application/octet-stream",
  });
  const fileReader = new FileReader();
  const dataUrl = await new Promise((resolve) => {
    fileReader.onload = () => resolve(fileReader.result);
    fileReader.readAsDataURL(file);
  }); // something like `data:application/octet-stream;base64,AQpy3Es9Ja0Abb=`
  return dataUrl.split("base64,")[1];
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
 * a js implementation of decoding base64, it's faster than atob, also faster than using fetch
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
