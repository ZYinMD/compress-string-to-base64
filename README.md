# compress-string-to-base64

Compress a string to Base64 and back. To be used in browser only.

```js
import { stringToBase64, base64ToString } from "compress-string-to-base64";

const original = `{"greeting": "Hello world ❤️"}`;
const compressed = await stringToBase64(original); // "H4sIAAAAAAAACvNIzcnJVyjPL8pJUXg0d8n7Hf0AaiisvhIAAAA="
const restored = await base64ToString(compressed); // "Hello world ❤️"
```

- Optimized for large strings (tens of megabytes).
- base64 can be about half the size of input.
- Encoding uses `FileReader.readAsDataURL()` which is faster than `btoa()` or a JavaScript implementation.
- Decoding uses a JavaScript implementation which is faster than `atob()` or `fetch()` of a data URL.
