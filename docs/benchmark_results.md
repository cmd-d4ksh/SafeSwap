# Benchmark results

Generated 2026-11-22T18:04:20 on Java 17.0.12, Mac OS X aarch64, 8 cores.

Method: synthetic catalogs from `ExerciseCatalogGenerator.scaled(N, 42)`; 2 warm-up rounds then median of 5 measured rounds, `System.nanoTime()`. Times are per operation.

## 1. Prefix search: Trie vs linear scan (top-10 autocomplete, 500 queries)

| N exercises | indexed keys | trie nodes | Trie µs/query | Linear scan µs/query | speed-up |
|---|---|---|---|---|---|
| 100 | 615 | 8,043 | 4.70 | 9.18 | 2.0x |
| 1,000 | 6,142 | 54,659 | 1.47 | 44.95 | 30.6x |
| 10,000 | 61,389 | 372,396 | 1.39 | 470.60 | 338.1x |
| 50,000 | 306,956 | 1,428,336 | 1.04 | 2429.36 | 2325.5x |

## 2. Phrase search over instruction text: KMP vs naive (5 phrases, all N texts)

| N exercises | text chars scanned | KMP ms/phrase | Naive ms/phrase | KMP comparisons | Naive comparisons | comparison ratio |
|---|---|---|---|---|---|---|
| 100 | 31,871 | 0.514 | 0.684 | 165,912 | 159,338 | 0.96 |
| 1,000 | 309,522 | 0.804 | 1.061 | 1,611,983 | 1,544,868 | 0.96 |
| 10,000 | 3,110,127 | 6.975 | 10.161 | 16,198,694 | 15,523,367 | 0.96 |
| 50,000 | 15,559,406 | 38.879 | 55.373 | 81,038,667 | 77,659,867 | 0.96 |

### 2b. Adversarial text (`a…ab`, pattern `a`×29 + `b`): worst case for naive matching

| text length | KMP ms | Naive ms | KMP comparisons | Naive comparisons | comparison ratio |
|---|---|---|---|---|---|
| 30,000 | 0.542 | 0.974 | 59,970 | 899,130 | 15.0 |
| 300,000 | 1.066 | 12.016 | 599,970 | 8,999,130 | 15.0 |
| 3,000,000 | 10.492 | 102.143 | 5,999,970 | 89,999,130 | 15.0 |
| 15,000,000 | 52.790 | 550.969 | 29,999,970 | 449,999,130 | 15.0 |

## 3. Contraindication check: Bloom filter vs HashSet vs rule engine (all N×12 pairs)

| N exercises | contraindicated pairs n | Bloom m (bits) | k | Bloom ns/check | HashSet ns/check | Rule-engine ns/check | Bloom memory | HashSet memory (est.) | memory ratio | target FPP | measured FPP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 128 | 1,227 | 7 | 199.2 | 55.7 | 188.9 | 160 B | 13.8 KB | 88.4x | 0.010 | 0.0177 |
| 1,000 | 1,204 | 11,541 | 7 | 126.3 | 60.3 | 103.4 | 1.4 KB | 128.0 KB | 90.5x | 0.010 | 0.0128 |
| 10,000 | 11,690 | 112,050 | 7 | 83.9 | 15.7 | 48.1 | 13.7 KB | 1.20 MB | 89.9x | 0.010 | 0.0100 |
| 50,000 | 58,278 | 558,599 | 7 | 85.7 | 14.5 | 56.8 | 68.2 KB | 6.18 MB | 92.7x | 0.010 | 0.0102 |

## 4. End-to-end substitution request: Bloom pre-check vs rule-engine-on-every-candidate

| N exercises | avg candidates / request | Bloom pipeline µs/request | Rule-only µs/request | rule evaluations avoided |
|---|---|---|---|---|
| 100 | 12 | 31.8 | 30.1 | 83.2% |
| 1,000 | 178 | 154.2 | 136.0 | 80.9% |
| 10,000 | 1,202 | 1286.0 | 841.3 | 85.3% |
| 50,000 | 6,580 | 6804.3 | 5823.8 | 87.2% |

HashSet memory is an analytic estimate for a 64-bit JVM with compressed oops: per entry 32 B HashMap.Node + 24 B String header + (16 B + key length) byte[] rounded to 8 B, plus a 4 B table slot per bucket at load factor 0.75.
