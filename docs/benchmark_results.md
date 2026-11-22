# Benchmark results

Generated 2026-11-22T21:07:28 on Java 17.0.12, Mac OS X aarch64, 8 cores.

Method: synthetic catalogs from `ExerciseCatalogGenerator.scaled(N, 42)`; 2 warm-up rounds then median of 5 measured rounds, `System.nanoTime()`. Times are per operation.

## 1. Prefix search: Trie vs linear scan (top-10 autocomplete, 500 queries)

| N exercises | indexed keys | trie nodes | Trie µs/query | Linear scan µs/query | speed-up |
|---|---|---|---|---|---|
| 100 | 597 | 7,802 | 3.86 | 14.75 | 3.8x |
| 1,000 | 6,080 | 55,056 | 1.47 | 45.61 | 31.0x |
| 10,000 | 61,245 | 377,411 | 1.52 | 509.27 | 335.2x |
| 50,000 | 305,496 | 1,440,634 | 1.06 | 2781.14 | 2632.8x |

## 2. Phrase search over instruction text: KMP vs naive (5 phrases, all N texts)

| N exercises | text chars scanned | KMP ms/phrase | Naive ms/phrase | KMP comparisons | Naive comparisons | comparison ratio |
|---|---|---|---|---|---|---|
| 100 | 31,142 | 0.550 | 0.786 | 162,230 | 155,445 | 0.96 |
| 1,000 | 307,516 | 0.804 | 1.039 | 1,601,835 | 1,533,393 | 0.96 |
| 10,000 | 3,094,966 | 7.867 | 10.968 | 16,119,992 | 15,440,298 | 0.96 |
| 50,000 | 15,481,122 | 43.638 | 56.808 | 80,631,130 | 77,235,661 | 0.96 |

### 2b. Adversarial text (`a…ab`, pattern `a`×29 + `b`): worst case for naive matching

| text length | KMP ms | Naive ms | KMP comparisons | Naive comparisons | comparison ratio |
|---|---|---|---|---|---|
| 30,000 | 0.561 | 1.281 | 59,970 | 899,130 | 15.0 |
| 300,000 | 1.106 | 9.843 | 599,970 | 8,999,130 | 15.0 |
| 3,000,000 | 11.069 | 99.354 | 5,999,970 | 89,999,130 | 15.0 |
| 15,000,000 | 54.583 | 510.585 | 29,999,970 | 449,999,130 | 15.0 |

## 3. Contraindication check: Bloom filter vs HashSet vs rule engine (all N×12 pairs)

| N exercises | contraindicated pairs n | Bloom m (bits) | k | Bloom ns/check | HashSet ns/check | Rule-engine ns/check | Bloom memory | HashSet memory (est.) | memory ratio | target FPP | measured FPP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 112 | 1,074 | 7 | 296.6 | 57.0 | 198.8 | 136 B | 12.2 KB | 91.7x | 0.010 | 0.0138 |
| 1,000 | 1,089 | 10,439 | 7 | 126.0 | 63.4 | 102.9 | 1.3 KB | 116.5 KB | 90.9x | 0.010 | 0.0093 |
| 10,000 | 11,163 | 106,999 | 7 | 89.0 | 14.8 | 44.6 | 13.1 KB | 1.15 MB | 90.1x | 0.010 | 0.0096 |
| 50,000 | 54,981 | 526,997 | 7 | 126.0 | 29.0 | 65.9 | 64.3 KB | 5.85 MB | 93.2x | 0.010 | 0.0101 |

## 4. End-to-end substitution request: Bloom pre-check vs rule-engine-on-every-candidate

| N exercises | avg candidates / request | Bloom pipeline µs/request | Rule-only µs/request | rule evaluations avoided |
|---|---|---|---|---|
| 100 | 14 | 46.5 | 18.7 | 85.5% |
| 1,000 | 135 | 117.5 | 108.3 | 83.0% |
| 10,000 | 1,770 | 1930.8 | 1397.3 | 84.1% |
| 50,000 | 8,298 | 11466.8 | 10333.0 | 85.6% |

HashSet memory is an analytic estimate for a 64-bit JVM with compressed oops: per entry 32 B HashMap.Node + 24 B String header + (16 B + key length) byte[] rounded to 8 B, plus a 4 B table slot per bucket at load factor 0.75.
