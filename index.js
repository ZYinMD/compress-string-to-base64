/*
 * Native Base64 support shipped in Firefox 133 on November 26, 2024, Safari 18.2 in December 2024, Chrome 140 on September 2, 2025, and Edge 140 on September 5, 2025.
 * Release references are https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/133, https://webkit.org/blog/16301/webkit-features-in-safari-18-2/, https://developer.chrome.com/release-notes/140, and https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-archive-stable-channel.
 * Detect each native method independently at call time so older browsers and partial implementations use the corresponding fallback without browser-version checks.
 * A native conversion failure must reject the public promise rather than retry through a more permissive fallback and hide invalid input.
 * The Chrome comparisons in bench/RESULTS.md explain the codec choices; bench/benchmark.js measures the fallback helpers directly so its historical comparisons remain meaningful.
 */
import {
  arrayBufferToBase64,
  decodeBase64,
  unzipToString,
  zipString,
} from "./modules.js";

// Prefer native typed-array codecs when available; the existing helpers keep the same gzip/Base64 format working in older browsers.
/**
 * compress a string with gzip, then encode to base64
 * @param {string} input
 */
export async function stringToBase64(input) {
  const zipped = await zipString(input);
  if (typeof Uint8Array.prototype.toBase64 === "function") {
    return new Uint8Array(zipped).toBase64();
  }
  return arrayBufferToBase64(zipped);
}

/**
 * decode base64 string into bytes, then unzip the bytes to the original string
 * @param {string} base64String
 */
export async function base64ToString(base64String) {
  const zipped = typeof Uint8Array.fromBase64 === "function"
    ? Uint8Array.fromBase64(base64String).buffer
    : decodeBase64(base64String);
  return unzipToString(zipped);
}
