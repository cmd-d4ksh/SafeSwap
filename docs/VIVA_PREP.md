# Viva Prep: How It Works, in Plain Language

This file walks through the three algorithms using **real data from this project**, then lists likely examiner questions with model answers. Every number below was produced by the actual code; the commands to reproduce them are given.

---

## 0. The 30-second pitch

> "A user can't do, say, a **Barbell Back Squat** because of a **lower-back strain**. Our Spring Boot backend finds the squat with a **trie**, collects every exercise that trains the same primary muscles, and checks each one for safety. The first check is a **Bloom filter** holding all 315 known-unsafe (exercise, injury) pairs. A 'no' from the filter is guaranteed correct, so we skip the expensive check. A 'maybe' is **never trusted**: we confirm it with the exact rule engine, which also tells the user *why* the exercise is unsafe. If the user gives a cue like 'neutral spine', **KMP** finds it inside each exercise's instruction text. The UI shows which method decided each result."

---

## 1. Trie, step by step

### What it is
A tree where each edge is one character and each root-to-node path spells a prefix. Words that share a prefix share the same path. A node is marked *terminal* if a full key ends there, and that node stores the ids of the exercises with that key.

### Concrete example (from our catalog)
Insert three names (lower-cased):

```
barbell bench press   → EX0001
barbell back squat    → EX0173
bench dip             → (id …)
```

```
(root)
 └─ b
    ├─ a ─ r ─ b ─ e ─ l ─ l ─ ␣ ─ b
    │                              ├─ e ─ n ─ c ─ h ─ ␣ ─ p ─ r ─ e ─ s ─ s ●  {EX0001}
    │                              └─ a ─ c ─ k ─ ␣ ─ s ─ q ─ u ─ a ─ t ●      {EX0173}
    └─ e ─ n ─ c ─ h ─ ␣ ─ d ─ i ─ p ●
```

**Query `"barbell b"`:**
1. Walk 9 edges: b→a→r→b→e→l→l→␣→b. That is 9 steps, **no matter how many exercises exist**.
2. Do a DFS of the subtree below that node, in alphabetical order. It reaches `…back squat` before `…bench press`, because `a` < `e`.
3. Stop after `limit` results (10 in the UI).

**Word-suffix trick:** we also insert `bench press`, `press`, `back squat` and `squat` (every suffix that starts at a word). Typing `press` then finds *Barbell Bench Press*, and the lookup is still a pure prefix walk. In the UI, type `overhead pr`: the response says `15 of 4,871 trie nodes visited`.

### Big-O
* Insert: **O(L)**, where L is the key length.
* Prefix search: **O(P + S)**, where P is the prefix length and S is the size of the subtree visited (small, because we stop at the limit). **It does not depend on N.**
* Linear scan: **O(N·P)** per keystroke.
* Measured: at 50,000 exercises the trie takes **1.1 µs** and the scan **2,556 µs**.

---

## 2. KMP, step by step

### The idea
The naive search slides the pattern one position at a time and re-compares from the start every time. KMP precomputes, for each position in the pattern, the length of the longest proper prefix that is also a suffix (`lps`). After a mismatch, it **jumps the pattern forward using `lps` and never moves backwards in the text**.

### Concrete example: pattern `"neutral spine"` (a cue users type)

```
index : 0 1 2 3 4 5 6 7 8 9 10 11 12
char  : n e u t r a l ␣ s p i  n  e
lps   : 0 0 0 0 0 0 0 0 0 0 0  1  2
```

* `lps[11] = 1`: the `n` in "spi**n**e" equals the first char `n`.
* `lps[12] = 2`: "spi**ne**" ends with `ne`, which is how the pattern starts.

(Reproduce with `KmpMatcher.buildFailureFunction("neutral spine")`.)

**Search the text `"neutral spineutral spine"`:**
1. i = 0…12: all 13 characters match, so we report a match at **0**.
2. Instead of restarting, set j = lps[12] = **2**. We already know the last two characters `ne` are the start of the pattern.
3. Continue with t[13] = `u` vs p[2] = `u`, and so on. That reports a match at **11**. The text pointer never went backwards.

Output: `[0, 11]`. The naive algorithm would have restarted at every position from 1 to 11.

In the app, the keyword's `lps` table is built **once** and reused across all candidates' instruction texts. The response shows `keywordMatchPositions` and a highlighted snippet.

### Big-O
* Build `lps`: **O(m)**.
* Search: **O(n)**, at most **2n comparisons**, because j can drop only as often as it rose.
* Naive: **O(n·m)** worst case.
* Measured: on normal English both are about linear (mismatches come early). On adversarial text (`aaaa…ab`), KMP does **15× fewer comparisons and runs about 4–7× faster**.

---

## 3. Bloom filter, step by step

### What it stores
The set of **contraindicated pairs** `"exerciseId|injuryTag"`. The rule engine marks 315 pairs unsafe across 285 exercises × 12 injuries.

### Parts
* **A bit array of m bits**, all 0 at the start.
* **k hash functions** that map a string to k positions.
* We write two 64-bit hashes ourselves: **FNV-1a** (h₁) and a **multiply-rotate hash with a Murmur-style finaliser** (h₂). The k positions are `(h₁ + i·h₂) mod m` for i = 0…k−1 (Kirsch–Mitzenmacher double hashing).

### Sizing for n = 315 and target p = 1 %
```
m = -n·ln(p) / (ln 2)²  = 315 · 4.605 / 0.4805 ≈ 3,020 bits  (384 bytes!)
k = (m/n)·ln 2          = 9.59 · 0.693       ≈ 7 hash functions
```

### Concrete example (real values from `HashFunctions`)
**Insert** `EX0173|lower-back-strain` (Barbell Back Squat, unsafe because it is axially loaded):
```
h1 = b3f25d6d07d0bd4e, h2 = b4f3b7382e1de78f
positions = [2034, 165, 1300, 2435, 550, 1701, 2836]   → set those 7 bits to 1
```

**Query** `EX0187|lower-back-strain` (Air Squat, tag `low-load`):
```
positions = [1537, 1724, 1895, 2066, 2237, 2424, 2595]
```
At least one of these bits is 0, so the answer is **"definitely not unsafe"**. Air Squat is accepted with method `BLOOM_NEGATIVE`, and the rule engine is never called.

**Query** `EX0173|lower-back-strain`: all 7 bits are 1, so the answer is **"possibly unsafe"**. We then run the rule engine. It finds `tag 'axial-loading': Axial (spinal compressive) loading aggravates lumbar strain.`, so the result is `BLOOM_POSITIVE_RULE_CONFIRMED` and the exercise is rejected with that reason.

### False positives, and why "possibly present + confirm" matters
Different keys can share bits. If all k bits of a **safe** pair happen to be set by other insertions, the filter says "maybe" for an exercise that is actually fine. That is a **false positive**. If we trusted it, we would wrongly tell a user that a safe exercise is dangerous and hide a good substitute. So:

| Bloom says | Meaning | What we do |
|---|---|---|
| **No** | Guaranteed not in the set (bits are never cleared, so an inserted key always has all k bits set) | Accept as safe, skip the rule check (`BLOOM_NEGATIVE`) |
| **Maybe** | In the set **or** a false positive | Run the exact rule engine. Violations → reject with the reason (`…RULE_CONFIRMED`). None → accept (`…RULE_CLEARED`, a false positive caught) |

Measured on our data: FPP **1.51 %** (theory: 1.00 %; with only about 3,100 negatives each false positive moves the estimate by 0.03 points, so it is noisy at this size; on 50,000 exercises the benchmark measures 1.01 %). Test **S2** shrinks the filter to 8 bits, so *everything* is a "maybe", and checks that the final answer is **identical**: false positives cost only time, never correctness.

### Big-O
* Add/query: **O(k)** bit operations plus hashing the key, **independent of n**.
* Memory: **m ≈ 9.6 bits per element at 1 %**, regardless of key length.
* Measured memory: **about 90× less than a HashSet** (66 KB vs 6.0 MB for 57k pairs).

---

## 4. Big-O cheat sheet

| Operation | Time | Space |
|---|---|---|
| Trie insert / exact lookup | O(L) | O(L) per new key (worst) |
| Trie prefix search (top-k) | O(P + visited subtree) | — |
| Linear prefix scan | O(N·P) | O(N) |
| KMP preprocessing | O(m) | O(m) |
| KMP search | O(n), ≤ 2n comparisons | O(1) extra |
| Naive search | O(n·m) worst | O(1) |
| Bloom add / query | O(k) (+ O(|key|) hashing) | m = −n ln p/(ln 2)² bits |
| HashSet lookup | O(1) expected (+ O(|key|) hash/equals) | O(n·|key|) + ~60 B/entry |
| Bloom FPP | (1 − e^{−kn/m})^k | optimal k = (m/n) ln 2 |

---

## 5. Likely examiner questions, with model answers

**Q1. Why not just use a HashMap instead of a trie?**
A HashMap answers *exact* lookups in O(1), but autocomplete needs **prefix** lookups: "give me every name starting with `ben`". With a HashMap you would either scan every key (O(N·P), which is our linear baseline) or store every prefix of every name as a separate key, which costs O(N·L²) memory with no ordering. A trie shares common prefixes, answers in O(P + output) independent of N, and returns results already in alphabetical order. Measured at 50k exercises: 1 µs vs 2.6 ms per keystroke. (We do use a HashMap as the child container inside each trie node, and for id lookup, as infrastructure. That is allowed.)

**Q2. What happens if the Bloom filter gives a false positive here?**
Nothing wrong reaches the user. A Bloom "maybe" is never shown as a verdict. It triggers the exact `RuleEngine.evaluate`. If the rule engine finds no violation, the exercise is accepted and labelled `BLOOM_POSITIVE_RULE_CLEARED`, so the UI even shows that a false positive was caught. The only cost is one extra rule evaluation. Test S2 forces 100 % false positives and checks the result list is unchanged.

**Q3. Can the Bloom filter give a false negative, i.e. say "safe" for an unsafe exercise?**
No, as long as it was built from the same rule set. Insertion sets k bits and bits are never cleared, so every inserted pair always finds all k bits set. That is why we can skip the rule check on a "no". The one way to break this would be to change the rules without rebuilding the filter. We avoid that by building the filter and the rule engine together from one snapshot at startup.

**Q4. Why KMP over naive string matching?**
Naive matching is O(n·m) in the worst case, because after a partial match it moves back in the text and starts over. KMP precomputes the `lps` table, so after a mismatch it knows how much of the pattern is already matched and never re-reads text. It is **O(n + m) guaranteed**. Our honest measurement: on ordinary English instruction text, both do about the same comparisons, because mismatches happen at the first character. KMP was still about 1.4× faster in wall time. On repetitive text, KMP did **15× fewer comparisons**. We chose it for the guaranteed worst case, since keywords come from users and the text could be anything.

**Q5. How did you choose m and k? What if you got them wrong?**
From the standard formulas: m = −n ln p / (ln 2)² and k = (m/n) ln 2. With p = 1 % and n = 315, that gives 3,020 bits and k = 7, which leaves about 50 % of bits set at capacity (we measured 52.3 %). If n grows past the design size, the FPP rises fast. Test B5 inserts 5× the capacity and the FPP exceeds 40 %. Correctness is unaffected (no false negatives, and positives are still confirmed), but more checks are wasted. The fix is to size from the real n at load time, which we do, or rebuild.

**Q6. Your benchmark shows the HashSet is faster per lookup than your Bloom filter. Why use the Bloom filter at all?**
Correct, and we report it. Java caches `String.hashCode`, so a HashSet probe is about 15 ns, while our filter computes two 64-bit hashes and probes 7 bits (about 85 ns). The Bloom filter's advantages are **memory** (90× smaller, so it fits in cache or on a phone) and **avoiding expensive authoritative checks**: it skipped 84–90 % of rule evaluations. In our coursework setup the rule engine is in memory and cheap, so wall time is about the same. In a real deployment, where the authoritative rules live in a database or remote clinical service, skipping 85 % of those calls is the big win. At tiny scale, a HashSet is the better choice.

**Q7. Is a naive scan ever better than the trie?**
Yes. At N = 100 the scan takes 19 µs vs 5 µs for the trie: both are invisible to a user, and the scan has no build cost and almost no memory overhead. Our trie with word suffixes uses about 28 nodes per exercise. The trie wins clearly once N reaches the thousands, and the gap grows linearly with N.

**Q8. How do you rank the substitutes?**
`score = 0.45·Jaccard(primary muscles) + 0.15·Jaccard(secondary) + 0.20·[same movement pattern] + 0.10·[shares equipment] + 0.10·[KMP keyword hit]`. Every result returns this breakdown and an `acceptedBecause` list, so the ranking is fully explainable. The weights are heuristic, which is listed as a limitation.

**Q9. What happens with an empty catalog, an unknown injury, or no safe option?**
* Empty catalog: HTTP **503 `CATALOG_EMPTY`**.
* Unknown injury: **400** with the list of valid tags.
* Ambiguous name like "Squat": **400** with trie suggestions.
* No safe substitute: **200 with `status: NO_SAFE_SUBSTITUTE`**, a reason, and the full list of rejected exercises with their rule violations. It is never a silent empty "OK".

Duplicates in the data file are dropped at load and listed in `/api/catalog/stats` (the shipped file has 2 on purpose).

**Q10a. Isn't the 3D gym just decoration? Where's the algorithm?**
The 3D gym only replaces typing with pointing. Every list it shows comes from the backend: a station's exercises come from **trie** lookups (exact tag-trie matches on equipment, plus name-trie word-prefix matches on keywords like `leg press`), and the swaps come from the same `/api/substitutions` pipeline (trie → Bloom filter → rule confirmation → ranking). The browser holds no catalog and no rules. It was built for first-time gym-goers who don't know exercise names but can point at a machine and at where it hurts.

**Q10d. The examiner gives us a new dataset. What happens?**
Use **Upload your own data** (classic view) or `POST /api/catalog`. The Java loader validates every row (duplicates by normalised name or id, missing muscles, unknown movement pattern), reports what it rejected, rebuilds the tries, the contraindication set and a freshly sized Bloom filter, and every page uses the new catalog. An empty upload is refused with `CATALOG_UPLOAD_EMPTY` and the old catalog stays. **Restore sample data** resets it.

**Q10c. How is the weekly plan built, and can it ever include something unsafe?**
`POST /api/plans` screens all exercises for the injury: the Bloom filter clears most instantly, and every "maybe" is confirmed by the exact rule engine. Only exercises that pass go into a muscle-slot template (push/pull/legs etc.), ranked for beginners (machines and cables first). A test rebuilds plans for three injuries × 2–4 days and re-checks every planned exercise with the rule engine. If a muscle has no safe option, the slot is dropped, never filled with an unsafe exercise.

**Q10b. How does the coach know which movement to show?**
The server decides. `FormGuideService` keeps an ordered list of keyword → motion rules and builds one **KMP matcher** (failure function computed once) per keyword at startup. For an exercise it scans the lower-cased name with each matcher in order and returns the first hit, e.g. "Machine Leg Press" → `leg press` → `legpress`. Order matters: `leg press` is checked before `squat`, and `rotation`/`throw` before `row`, because "throw" contains "row" (there is a regression test for this). If nothing matches, the movement pattern's default is used. The browser only receives the motion name and plays its animation; it never classifies exercises.

**Q10. Which parts are your own implementation, and which use libraries?**
Hand-written: `Trie`, `KmpMatcher`, `BloomFilter`, `BitArray`, both hash functions, both baselines, the rule engine, and the ranking. Libraries are used only for infrastructure: Spring Boot (HTTP), Jackson (JSON), JUnit, a `TreeMap` as the child map inside a trie node, and a `long[]` as the bit storage. We call no library trie, search, hash or Bloom-filter API.

---

## 6. Live team demo (about 8 minutes)

Before you start: both servers running (`mvn spring-boot:run` in `backend/`, `node server.js` in `frontend/`), http://localhost:5173 open, `frontend/sample_upload.json` ready, and a terminal in `backend/`.

| Time | Who | What to show | What to say |
|---|---|---|---|
| 0:00–0:45 | Daksh | Open the site, press **Walk in** | The problem: beginners with an injury don't know what to avoid or what to do instead. Our users are first-time gym-goers and trainers. |
| 0:45–2:30 | Laksh | **Knee → Continue → 3 days → Build my plan**. Open the Legs tab, the **Avoid for now** box, then **How we built this plan** | Every exercise was screened. The Bloom filter cleared most instantly; every "maybe" was confirmed by the exact rules, so 6 false alarms were cleared and 28 truly unsafe exercises were left out. No squats or leg press on Legs day. |
| 2:30–3:30 | Daksh | **▶ How to do it** on a plan card (Slow-mo, Side view); read the small print; **Show me where** | The demo motion is chosen on the server by KMP keyword rules; the machine location comes from the tries. |
| 3:30–5:00 | Daksh | **Swap one exercise instead → Squat Rack → Barbell Back Squat → Lower back → Find a safe swap**. Open **How we checked this** | Trie resolves the name; same-muscle candidates; Bloom pre-check; rule confirmation; ranking. The target is flagged with the exact reason. |
| 5:00–6:00 | Laksh | Footer → **Upload your own data** → upload `sample_upload.json` → **Build a plan with this list** → **Restore the built-in list** | Validation: 15 of 17 accepted, 1 duplicate and 1 invalid row rejected with reasons. All indexes are rebuilt on the server. |
| 6:00–7:00 | Daksh | **Classic view**: type `overhead pr` (trie: 15 of 4,871 nodes); submit `Squat` (ambiguous → suggestions); injury `finger-pulley-strain` (nothing rejected) | Failure handling: ambiguous input gives suggestions, never a guess. |
| 7:00–8:00 | Laksh | Terminal: `mvn test` (43 green). Open `docs/charts/membership.svg` and `docs/benchmark_results.md` | Bloom uses ~90× less memory than a HashSet; trie is ~2,600× faster than a linear scan at 50k; KMP makes 15× fewer comparisons on adversarial text. A HashSet is faster per lookup at our size, and we say so. |

### Short version (if the examiner only wants 2 minutes)

1. Open http://localhost:5173 and press **Walk in**: the doors open and you walk into the gym. Tap the **knee**, pick 3 days, and **Build my plan**: show that the Legs day has no squats or leg press (they are under "Avoid for now"), today's machines glow, and **How to do it** opens the coach. Then use **Swap one exercise at a machine** for the next step.
2. Tap **Squat Rack** → **Barbell Back Squat** → tap the **lower back** on the body. The stations holding the swaps glow in their zone colour; press **Show me where** on a card. Open **"How we checked"** and walk through trie → Bloom → confirmation. Press **How to do it** on Air Squat: the 3D coach demonstrates it (try Slow-mo and Side view), and the small print says which KMP keyword picked the demo. Show **Back** and **Start over**.
3. Footer → **Classic view**. Type `overhead pr` and point at the trie line under the box: *"15 nodes visited out of 4,871"*.
4. Choose **Barbell Overhead Press** + **Shoulder impingement**, keyword `shoulder`, and submit.
5. Show:
   * the banner (`10 safe substitutes from 30 candidates, 19 rejected`);
   * the target marked **TARGET UNSAFE** with its reason;
   * the **Method used** panel (Bloom negatives/positives, rule checks run vs skipped, KMP comparisons);
   * the green `BLOOM_NEGATIVE` badges and the KMP-highlighted snippets;
   * the **Rejected** list with confirmed reasons.
6. Error states: submit `Squat` (ambiguous → suggestions), then an injury with zero contraindications (`finger-pulley-strain`), where nothing is rejected.
7. Scroll to the stats card: m = 3,020, k = 7, measured FPP ≈ 1.51 %, 2 duplicate rows rejected at load.
8. Terminal: run `mvn test` (43 green) and open `docs/benchmark_results.md`.

---

## 7. Individual viva scripts (about 2 minutes each)

Each of you must explain: **your contribution, one key algorithm, why it is correct, and its complexity**. Say it in your own words; don't read it.

### Daksh Shah (2402180): Trie and KMP

1. **Contribution (15 s):** "I built the Trie and KMP, the search endpoints, the machine placement in the gym, the form-guide demo selection, the 3D frontend, and the Trie/KMP tests."
2. **Trie (45 s):** "Each node is one character; words with the same start share a path. I insert every exercise name plus every suffix that starts at a word, so 'press' finds 'Barbell Bench Press'. A search walks the prefix, O(length), then collects the subtree, O(output). The catalog size doesn't matter. Against a linear scan it's about 2,600× faster at 50,000 exercises. The cost is memory: about 1.4 million nodes."
3. **KMP (45 s):** "First I build the failure function: for each position, the longest proper prefix that is also a suffix. While scanning, a mismatch moves the pattern using that table instead of restarting, so the text pointer never goes back. That makes it O(n + m), at most 2n comparisons, which test K8 checks. On normal text it's similar to naive; on repetitive text it does 15× fewer comparisons."
4. **Correctness (15 s):** "Property tests compare the trie with a linear scan on 2,000 random queries, and KMP with naive matching on 3,000 cases. They always agree."

### Laksh Merani (2408098): Bloom filter and the safety pipeline

1. **Contribution (15 s):** "I built the Bloom filter and its hash functions, the rule engine and safety pipeline, the weekly plan builder, data validation and upload, and the benchmarks."
2. **Bloom filter (50 s):** "It's a bit array of m bits and k hash functions. Adding 'exercise|injury' sets k bits; checking reads the same k bits. Any 0 means definitely not in the set; all 1s means possibly. I size it with m = −n ln p / (ln 2)² and k = (m/n) ln 2: for 315 pairs at 1 %, that's 3,020 bits (384 bytes) and k = 7. The k positions come from two of my own hashes (FNV-1a and a mix hash) using h1 + i·h2."
3. **Why it is safe (30 s):** "There are no false negatives because bits are never cleared. A false positive is possible, so every 'maybe' goes to the exact rule engine, and only a confirmed rule rejects an exercise. Test S2 makes the filter useless on purpose (8 bits) and the answers stay identical: false positives cost time, never correctness."
4. **Complexity and results (25 s):** "O(k) time per check, m bits of memory regardless of key length. It's about 90× smaller than a HashSet, skips 83–86 % of rule checks, and the measured false-positive rate is 1.01 % at 50,000 exercises against a 1 % target."

---

## 8. If the examiner asks you to walk through the Java code

Open the file, scroll to the line, and explain it in this order: **input → loop → what each step does → return value → complexity**.

| Likely request | File and line (under `backend/src/main/java/com/exsub/`) | Who |
|---|---|---|
| Trie insert | `algo/Trie.java:77` `insert(...)` | Daksh |
| Trie prefix search | `algo/Trie.java:131` `searchPrefix(...)` | Daksh |
| KMP failure function | `algo/KmpMatcher.java:33` `buildFailureFunction(...)` | Daksh |
| KMP matching loop | `algo/KmpMatcher.java:54` `findAll(...)` | Daksh |
| Bloom sizing formulas | `algo/BloomFilter.java:56` `optimalBits`, `:60` `optimalHashes` | Laksh |
| Bloom add / check | `algo/BloomFilter.java:64` `add`, `:74` `mightContain` | Laksh |
| Hash functions | `algo/HashFunctions.java:55` `fnv1a64`, `:70` `mixHash64` | Laksh |
| Bloom → rule confirmation | `engine/SubstitutionEngine.java:71` (inside `substitute`, line 44) | Laksh |
| Exact rule check | `engine/RuleEngine.java:36` `evaluate(...)` | Laksh |
| Plan builder | `service/PlanService.java:94` `build(...)`, Bloom check at `:120` | Laksh |

---

## 9. Edge cases the examiner might ask you to show

| Ask | How to show it | Expected result |
|---|---|---|
| Empty dataset | Upload a file containing `[]` | "The uploaded dataset is empty; the current catalog was kept." |
| Duplicates / invalid rows | Upload `sample_upload.json` | 15 of 17 accepted; the duplicate and the broken row are listed with reasons |
| Unknown injury | `curl -X POST localhost:8085/api/substitutions -H 'Content-Type: application/json' -d '{"exercise":"Barbell Back Squat","injuryTag":"broken-leg"}'` | 400 `UNKNOWN_INJURY_TAG` with the list of valid tags |
| Ambiguous exercise | Classic view: exercise `Squat` | 400 `AMBIGUOUS_EXERCISE` with suggestions |
| No safe substitute | Run `SubstitutionEngineTest` (no-safe-substitute case) | Status `NO_SAFE_SUBSTITUTE` with a message, never an unsafe result |
| Injury with no rules | Injury `finger-pulley-strain` | Nothing rejected |
| Bad day count | `curl -X POST localhost:8085/api/plans -H 'Content-Type: application/json' -d '{"injuryTag":"none","daysPerWeek":7}'` | 400 `DAYS_OUT_OF_RANGE` |

---

## 10. Numbers to remember

| Fact | Value |
|---|---|
| Exercises / injury rules / machines | 285 / 12 / 35 |
| Unsafe (exercise, injury) pairs | 315 |
| Bloom filter | m = 3,020 bits (384 B), k = 7, target 1 % |
| Measured false-positive rate | 1.51 % on our 285 exercises (noisy), 1.01 % at 50,000 |
| Bloom vs HashSet memory | ~90× smaller |
| Rule checks skipped thanks to Bloom | 83–86 % |
| Trie vs linear scan at 50,000 | ~1 µs vs ~2,800 µs (~2,600× faster) |
| KMP vs naive, adversarial text | 15× fewer comparisons, at most 2n |
| Tests | 43, all passing |
| Benchmark sizes | 100 / 1,000 / 10,000 / 50,000 |

---

## 11. Checklist the day before

- [ ] Both of you can run the app from a fresh `git clone` using the README.
- [ ] `mvn test` shows 43 passing on the demo laptop.
- [ ] Laptop charged; Wi-Fi works (three.js and fonts load from the internet on first open).
- [ ] If showing the Render link, open it a minute early (free plan wakes slowly).
- [ ] Each of you has rehearsed your 2-minute script and your rows in section 8.
- [ ] Each of you can answer Q1–Q10 above without notes.
- [ ] Both of you have your own commits in the GitHub history.
