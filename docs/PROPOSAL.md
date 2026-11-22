# Project Proposal: SafeSwap Gym (Injury-Safe Exercise Planning & Substitution)

**Course:** Advanced Algorithm · CIA 3 · Semester V · B.Tech CS AI & ML · 2026–27

| Team member | Register no. / ID | Role |
|---|---|---|
| Daksh Shah | 2402180 | Trie + KMP, search APIs, gym station placement, form guides, 3D frontend |
| Laksh Merani | 2408098 | Bloom filter, safety pipeline, weekly plan builder, data validation and upload, benchmarks |

## 1. Real-world problem
People with a minor injury (lower-back strain, shoulder impingement, jumper's knee, tennis elbow, …) usually keep training, but they do not know **which exercises to avoid** and **what to do instead**. Beginners also don't know machine names or correct form. Generic plans ignore the injury, and web search answers are not checked against it, which risks making the injury worse or drives people to stop training.

## 2. Target users
- **First-time and beginner gym-goers** managing a minor injury (primary user).
- **Personal trainers and physiotherapists** who want a fast, explainable reference for safe swaps.

## 3. Proposed features
1. **Pain check first:** the user taps where it hurts on a body figure (or says nothing hurts) and picks how many days a week they can train.
2. **Safe weekly plan:** a 2–4 day split (upper/lower, push/pull/legs, push/pull/legs/arms) where **every exercise is screened for the injury**, with sets × reps, a warm-up and an "avoid for now" list with reasons.
3. **Safe substitute for one exercise:** pick a machine in a 3D gym, pick the exercise, say what hurts, and get ranked safe swaps with an explanation.
4. **Autocomplete search** of 285 exercises by name, muscle, equipment or tag; **phrase search** inside exercise instructions.
5. **Form guidance:** a 3D coach demonstrates each exercise, with steps, cues, mistakes, breathing and tempo.
6. **Upload your own dataset:** validated on the server (empty file, duplicates, invalid rows).

## 4. Core techniques and why each is appropriate
| Technique (syllabus unit) | Where it is used | Why it fits |
|---|---|---|
| **Trie** (Unit 4, text search) | Name/tag autocomplete, exact name resolution, gym station placement | Prefix queries cost O(prefix length + output), independent of catalog size, unlike a linear scan. |
| **KMP string matching** (Unit 4) | Keyword search inside instruction text; choosing the demo motion from the exercise name | Guaranteed O(n + m) even on repetitive text where naive matching degrades to O(n·m). |
| **Bloom filter** (Unit 6, randomization/probabilistic DS; **CO5**) | Pre-check of every (exercise, injury) pair against the set of contraindicated pairs | Constant-time, ~90× less memory than a HashSet; no false negatives, so a "no" safely skips the expensive rule check. **Every "possibly present" hit is confirmed by an exact rule engine**, so no exercise is rejected on a false positive. |

## 5. Data source
Synthetic but realistic: ~100 hand-written base movements expanded over equipment variants into **285 unique exercises** (plus 2 deliberate duplicates), and **12 injury rules** written from general physiotherapy guidance. They are **not clinically validated and not medical advice**. Large synthetic catalogs (up to 50,000 exercises) are generated deterministically for benchmarks.

## 6. Measurable success criteria
| # | Criterion | Target |
|---|---|---|
| S1 | Unsafe exercises recommended (checked against the exact rule engine for every plan and swap in tests) | **0** |
| S2 | Bloom filter false negatives; positives accepted without confirmation | **0 / 0** |
| S3 | Measured Bloom FPP at design load (large n) | ≈ target 1 % |
| S4 | Bloom memory vs HashSet of the same pairs | ≥ 50× smaller |
| S5 | Trie autocomplete at 50,000 exercises | < 10 µs per query and ≥ 10× faster than linear scan |
| S6 | KMP character comparisons on adversarial text | ≤ 2n (and fewer than naive) |
| S7 | Server time: safe swap / weekly plan on the shipped catalog | < 10 ms / < 50 ms |
| S8 | Invalid inputs (empty dataset, duplicates, unknown injury/exercise, bad day count) | Explicit error code, never a silent wrong answer |
| S9 | Taps from opening the site to a safe plan | ≤ 5 |
