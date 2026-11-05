# compress-string-to-base64

Turn a string to Base64 and back. To be used in browser only.

```js
import { stringToBase64, base64ToString } from 'compress-string-to-base64';

const original = `{"greeting": "Hello world ❤️"}`;
const compressed = await stringToBase64(original); // "H4sIAAAAAAAACvNIzcnJVyjPL8pJUXg0d8n7Hf0AaiisvhIAAAA="
const restored = await base64ToString(compressed); // {"greeting": "Hello world ❤️"}
```

- Optimized for large strings (megabytes or more). Compressed string can be about half the size of the input string.
- Both functions return promises that resolve to strings. Conversion failures, including damaged inputs reject the promise.
- In browsers, encode to Base64 can be done with `Uint8Array.prototype.toBase64()`, `FileReader.readAsDataURL()`, `btoa()`, or custom JavaScript; decode can be done with `Uint8Array.fromBase64()`, `atob()`, data-URL `fetch()`, or custom JavaScript. This package prefers native methods (Chromium 140+) and falls back to FileReader encoding and lookup-table decoding as the 2nd fastest option.
