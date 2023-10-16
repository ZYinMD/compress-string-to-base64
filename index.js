import {
  arrayBufferToBase64,
  decodeBase64,
  unzipToString,
  zipString,
} from "./modules.js";

/**
 * compress a string with gzip, then encode to base64
 * @param {string} input
 */
export async function stringToBase64(input) {
  const zipped = await zipString(input);
  const base64String = await arrayBufferToBase64(zipped);
  return base64String;
}

/**
 * decode base64 string into bytes, then unzip the bytes to the original unpressed string
 * @param {string} base64String
 */
export async function base64ToString(base64String) {
  const zipped = decodeBase64(base64String);
  const originalString = await unzipToString(zipped);
  return originalString;
}
