# Benchmark results

Generated 2026-11-22T18:51:38 on Java 17.0.12, Mac OS X aarch64, 8 cores.

Method: synthetic catalogs from `ExerciseCatalogGenerator.scaled(N, 42)`; 2 warm-up rounds then median of 5 measured rounds, `System.nanoTime()`. Times are per operation.

## 1. Prefix search: Trie vs linear scan (top-10 autocomplete, 500 queries)

| N exercises | indexed keys | trie nodes | Trie µs/query | Linear scan µs/query | speed-up |
|---|---|---|---|---|---|
| 100 | 607 | 7,852 | 5.01 | 19.42 | 3.9x |
| 1,000 | 6,110 | 54,625 | 1.40 | 43.50 | 31.2x |
| 10,000 | 61,333 | 374,831 | 1.46 | 455.79 | 312.0x |
| 50,000 | 305,910 | 1,432,433 | 1.09 | 2556.19 | 2349.1x |

## 2. Phrase search over instruction text: KMP vs naive (5 phrases, all N texts)

| N exercises | text chars scanned | KMP ms/phrase | Naive ms/phrase | KMP comparisons | Naive comparisons | comparison ratio |
|---|---|---|---|---|---|---|
| 100 | 29,614 | 0.465 | 0.866 | 154,246 | 147,091 | 0.95 |
| 1,000 | 311,839 | 0.839 | 1.133 | 1,624,054 | 1,556,922 | 0.96 |
| 10,000 | 3,108,648 | 7.733 | 11.216 | 16,190,376 | 15,518,083 | 0.96 |
| 50,000 | 15,520,838 | 42.807 | 57.576 | 80,834,353 | 77,452,212 | 0.96 |

### 2b. Adversarial text (`a…ab`, pattern `a`×29 + `b`): worst case for naive matching

| text length | KMP ms | Naive ms | KMP comparisons | Naive comparisons | comparison ratio |
|---|---|---|---|---|---|
| 30,000 | 0.526 | 2.021 | 59,970 | 899,130 | 15.0 |
| 300,000 | 1.036 | 7.642 | 599,970 | 8,999,130 | 15.0 |
| 3,000,000 | 10.471 | 76.871 | 5,999,970 | 89,999,130 | 15.0 |
| 15,000,000 | 53.226 | 384.541 | 29,999,970 | 449,999,130 | 15.0 |

## 3. Contraindication check: Bloom filter vs HashSet vs rule engine (all N×12 pairs)

| N exercises | contraindicated pairs n | Bloom m (bits) | k | Bloom ns/check | HashSet ns/check | Rule-engine ns/check | Bloom memory | HashSet memory (est.) | memory ratio | target FPP | measured FPP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 105 | 1,007 | 7 | 440.1 | 56.9 | 185.5 | 128 B | 11.5 KB | 91.9x | 0.010 | 0.0064 |
| 1,000 | 1,158 | 11,100 | 7 | 140.8 | 61.0 | 99.0 | 1.4 KB | 123.5 KB | 90.9x | 0.010 | 0.0093 |
| 10,000 | 11,356 | 108,848 | 7 | 86.3 | 14.2 | 40.2 | 13.3 KB | 1.17 MB | 90.0x | 0.010 | 0.0096 |
| 50,000 | 56,590 | 542,419 | 7 | 82.2 | 14.4 | 42.6 | 66.2 KB | 6.01 MB | 92.9x | 0.010 | 0.0098 |

## 4. End-to-end substitution request: Bloom pre-check vs rule-engine-on-every-candidate

| N exercises | avg candidates / request | Bloom pipeline µs/request | Rule-only µs/request | rule evaluations avoided |
|---|---|---|---|---|
| 100 | 13 | 41.4 | 17.5 | 85.8% |
| 1,000 | 164 | 143.6 | 127.0 | 83.6% |
| 10,000 | 1,408 | 1385.0 | 956.0 | 90.2% |
| 50,000 | 7,368 | 6364.6 | 6224.9 | 86.9% |

HashSet memory is an analytic estimate for a 64-bit JVM with compressed oops: per entry 32 B HashMap.Node + 24 B String header + (16 B + key length) byte[] rounded to 8 B, plus a 4 B table slot per bucket at load factor 0.75.
