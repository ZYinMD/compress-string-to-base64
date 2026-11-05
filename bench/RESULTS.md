# Base64 conversion benchmark

Measured on November 5, 2026, by Codex (GPT-6).

FileReader was faster than the tested `btoa()` and joined-chunk JavaScript encoders. The package lookup decoder was roughly tied with `atob()` plus a preallocated byte loop; it was much faster than `atob()` plus `Uint8Array.from(callback)` and faster than fetching a data URL. Native typed-array Base64 APIs were the fastest tested methods in both directions. These findings qualify the README claims; they do not establish that one implementation is fastest in every browser or against every possible JavaScript implementation.

## Environment and inputs

Chrome 154 on macOS, Apple M4, ARM64. The page used cross-origin isolation for high-resolution timers. Node 24.22.1 prepared read-only local snapshots; conversion timings were measured in Chrome, not Node.

All four inputs were already-compressed DB JS files from the two real NAS archives. The original gzip payloads were extracted without recompression or JSON parsing. File-handle and pathname metadata were checked before and after extraction to reject a source changing during the snapshot. The benchmark then used local snapshots; no archive files were modified.

| Archive DB | DB JS MiB | Gzip MiB | Original JSON MiB | Gzip + Base64 / JSON |
| --- | ---: | ---: | ---: | ---: |
| db_authors.js (tiktok-main-account) | 0.368 | 0.276 | 0.879 | 41.9% |
| db_following.js (douyin-main-account) | 9.843 | 7.382 | 21.166 | 46.5% |
| db_videos.js (tiktok-main-account) | 27.163 | 20.372 | 97.029 | 28.0% |
| db_texts.js (douyin-main-account) | 40.109 | 30.082 | 67.268 | 59.6% |

## Method

Each direction used two warmup rounds and seven measured rounds in each of two page loads, with different deterministic shuffle seeds (95045 and 90210). Method order was shuffled every round. Each cell below is the median of 14 observations, in milliseconds per complete conversion. Parentheses show the observed 10th–90th percentile spread, not a confidence interval. Small inputs used fixed batches of up to 16 conversions, targeting about 4 MiB per batch; timings were divided by the batch size. Larger inputs used one conversion per observation.

All encoders returned a complete Base64 string and all decoders returned an ArrayBuffer. Every measured batch’s final result was checked against the expected full string or bytes outside the timed interval. Loading, NAS I/O, JS-wrapper extraction, gzip, JSON parsing, and correctness checks were excluded. Output allocation, FileReader completion, fetch/data-URL processing, and incidental garbage collection remained in elapsed time. The tab remained visible; method-order rotation spreads allocator and garbage-collection effects.

The `btoa()` encoder includes conversion of bytes to a binary string using 32,768-byte chunks. The JavaScript encoder joins bounded chunks of 16,383 input bytes to avoid returning a large unflattened string rope. The two `atob()` rows include conversion of its binary string into bytes. The fetch row constructs its data URL inside the measured operation. Native APIs were included only when available.

## Encoding

| Method | 0.276 MiB | 7.382 MiB | 20.372 MiB | 30.082 MiB |
| --- | ---: | ---: | ---: | ---: |
| FileReader (package) | 0.966 (0.491–1.308) | 27.212 (17.089–29.658) | 55.003 (35.796–61.523) | 75.330 (63.718–77.808) |
| btoa + chunked byte conversion | 15.099 (8.359–17.636) | 422.475 (396.765–459.967) | 1194.788 (433.014–1329.873) | 1869.445 (1771.985–2033.748) |
| JavaScript lookup encoder (joined chunks) | 6.121 (5.206–7.208) | 159.725 (143.814–169.817) | 436.908 (368.790–484.605) | 646.257 (303.811–710.993) |
| Uint8Array.toBase64 (native) | 0.085 (0.046–0.112) | 2.997 (1.673–4.395) | 8.143 (4.542–10.143) | 12.570 (6.470–18.899) |

## Decoding

| Method | 0.276 MiB | 7.382 MiB | 20.372 MiB | 30.082 MiB |
| --- | ---: | ---: | ---: | ---: |
| JavaScript lookup decoder (package) | 1.557 (1.344–1.808) | 43.910 (38.186–47.822) | 132.218 (116.772–151.000) | 186.057 (164.679–225.055) |
| atob + preallocated byte loop | 1.345 (1.120–1.674) | 43.108 (39.406–62.907) | 118.100 (69.388–146.899) | 180.697 (171.253–208.500) |
| atob + Uint8Array.from callback | 32.055 (29.939–35.287) | 971.942 (907.883–1058.746) | 2817.848 (2335.195–2969.225) | 4260.132 (1869.593–4389.667) |
| fetch(data URL) + arrayBuffer | 2.179 (2.047–2.405) | 78.180 (72.097–86.971) | 223.433 (204.383–252.731) | 330.625 (276.778–373.759) |
| Uint8Array.fromBase64 (native) | 0.143 (0.109–0.196) | 6.893 (6.061–7.780) | 19.598 (16.861–24.848) | 30.118 (26.056–31.300) |

## Interpretation

The old encoding claim held against the two explicit alternatives tested here. The old decoding claim was too broad: an optimized `atob()` byte-copy loop matched or slightly beat the package on these samples, while the callback-based byte conversion was much slower. A claim about `atob()` alone would also be unfair because it returns a binary string rather than the ArrayBuffer required by the package.

The public API selects `Uint8Array.prototype.toBase64()` and `Uint8Array.fromBase64()` independently when available, retaining FileReader encoding and lookup decoding as compatibility fallbacks. The tables' FileReader and package lookup rows measure these fallback helpers directly; the native rows correspond to the path selected in modern browsers. API details are specified in [the TC39 Base64 proposal](https://tc39.es/proposal-arraybuffer-base64/).

These measurements describe elapsed conversion time on one Mac and Chrome version. They do not measure peak memory or whole-application startup. A faster Base64 conversion does not give the same speedup to gzip decompression, JSON parsing, or filesystem work. No historical benchmark harness was present, so the exact implementations behind the original README claims could not be reconstructed.

## Artifacts

[The summary CSV](results-2026-11-05.csv) contains all medians and spreads. Machine-local original snapshots, provenance, and both raw runs are in `/tmp/base64-benchmark-2026-11-05/`; temporary-directory cleanup can remove them. Only aggregate measurements and benchmark code are stored in this repository.
