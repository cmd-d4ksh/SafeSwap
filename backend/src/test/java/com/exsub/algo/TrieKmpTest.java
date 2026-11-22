package com.exsub.algo;

import com.exsub.algo.baseline.LinearPrefixScan;
import com.exsub.algo.baseline.NaiveMatcher;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Correctness tests for algorithm unit 1: Trie + KMP.
 * Edge/boundary cases are marked [EDGE] in the display name.
 */
class TrieKmpTest {

    private static Trie sampleTrie() {
        Trie t = new Trie();
        t.insert("Barbell Bench Press", 1);
        t.insert("Barbell Back Squat", 2);
        t.insert("Bench Dip", 3);
        t.insert("Box Jump", 4);
        t.insert("Deadlift", 5);
        return t;
    }

    private static List<String> keys(Trie.SearchResult r) {
        List<String> out = new ArrayList<>();
        for (Trie.Match m : r.matches()) out.add(m.key());
        return out;
    }

    @Nested
    @DisplayName("Trie")
    class TrieTests {

        @Test
        @DisplayName("T1 [EDGE] empty trie: no keys, every lookup/prefix search returns empty")
        void emptyTrie() {
            Trie t = new Trie();
            assertTrue(t.isEmpty());
            assertEquals(0, t.keyCount());
            assertTrue(t.searchPrefix("a", 10).matches().isEmpty());
            assertTrue(t.searchPrefix("", 10).matches().isEmpty());
            assertFalse(t.containsKey("bench"));
            assertTrue(t.getExact("bench").isEmpty());
        }

        @Test
        @DisplayName("T2 [EDGE] single-character prefix returns all keys starting with it, lexicographically")
        void singleCharacterPrefix() {
            Trie t = sampleTrie();
            assertEquals(List.of("barbell back squat", "barbell bench press", "bench dip", "box jump"),
                    keys(t.searchPrefix("b", 10)));
            assertEquals(List.of("deadlift"), keys(t.searchPrefix("D", 10)));
            assertTrue(t.searchPrefix("z", 10).matches().isEmpty());
        }

        @Test
        @DisplayName("T3 [EDGE] exact full-string match: key found by getExact and included in its own prefix search")
        void exactFullStringMatch() {
            Trie t = sampleTrie();
            assertEquals(List.of(1), t.getExact("barbell bench press"));
            assertTrue(t.containsKey("BARBELL BENCH PRESS"));
            assertEquals(List.of("barbell bench press"), keys(t.searchPrefix("barbell bench press", 10)));
            // a strict prefix of a key is not itself a key
            assertFalse(t.containsKey("barbell bench"));
            assertTrue(t.hasPrefix("barbell bench"));
        }

        @Test
        @DisplayName("T4 prefix longer than any key / absent branch returns empty")
        void prefixNotPresent() {
            Trie t = sampleTrie();
            assertTrue(t.searchPrefix("barbell bench press extra", 10).matches().isEmpty());
            assertTrue(t.searchPrefix("bx", 10).matches().isEmpty());
        }

        @Test
        @DisplayName("T5 normalisation: case and repeated whitespace are ignored")
        void normalisation() {
            Trie t = sampleTrie();
            assertEquals(List.of("barbell back squat", "barbell bench press"),
                    keys(t.searchPrefix("  BaRbElL   b", 10)));
            assertThrows(IllegalArgumentException.class, () -> t.insert("   ", 9));
        }

        @Test
        @DisplayName("T6 duplicate insert is idempotent; same key with different ids aggregates ids")
        void duplicatesAndSharedKeys() {
            Trie t = new Trie();
            t.insert("overhead", 1);
            t.insert("overhead", 1);
            t.insert("Overhead", 2);
            assertEquals(1, t.keyCount());
            assertEquals(List.of(1, 2), t.getExact("overhead"));
        }

        @Test
        @DisplayName("T7 limit caps the number of returned keys")
        void limitRespected() {
            Trie t = sampleTrie();
            assertEquals(2, t.searchPrefix("b", 2).matches().size());
            assertTrue(t.searchPrefix("b", 0).matches().isEmpty());
        }

        @Test
        @DisplayName("T8 property: trie agrees with naive linear-scan baseline on 2,000 random queries")
        void agreesWithLinearScan() {
            Random rnd = new Random(7);
            Trie t = new Trie();
            LinearPrefixScan scan = new LinearPrefixScan();
            String alphabet = "abcde ";
            for (int i = 0; i < 500; i++) {
                StringBuilder sb = new StringBuilder("x");
                int len = 1 + rnd.nextInt(8);
                for (int j = 0; j < len; j++) sb.append(alphabet.charAt(rnd.nextInt(5)));
                t.insert(sb.toString(), i);
                scan.insert(sb.toString(), i);
            }
            for (int q = 0; q < 2000; q++) {
                StringBuilder p = new StringBuilder("x");
                int len = rnd.nextInt(4);
                for (int j = 0; j < len; j++) p.append(alphabet.charAt(rnd.nextInt(5)));
                assertEquals(scan.searchPrefixKeys(p.toString(), 1000), keys(t.searchPrefix(p.toString(), 1000)),
                        "prefix " + p);
            }
        }
    }

    @Nested
    @DisplayName("KMP")
    class KmpTests {

        @Test
        @DisplayName("K1 failure function matches hand-computed table")
        void failureFunction() {
            assertArrayEquals(new int[]{0, 1, 0, 1, 2, 2, 3}, KmpMatcher.buildFailureFunction("aabaaab"));
            assertArrayEquals(new int[]{0, 0, 0, 0}, KmpMatcher.buildFailureFunction("abcd"));
            assertArrayEquals(new int[]{0, 1, 2, 3}, KmpMatcher.buildFailureFunction("aaaa"));
        }

        @Test
        @DisplayName("K2 finds every occurrence, including overlapping ones")
        void overlappingMatches() {
            assertEquals(List.of(0, 1, 2), new KmpMatcher("aaaa").findAll("aaaaaa"));
            assertEquals(List.of(0, 7), new KmpMatcher("abcab").findAll("abcabc abcab"));
        }

        @Test
        @DisplayName("K3 matches a movement phrase inside real instruction text, case-insensitively")
        void instructionText() {
            String text = "Hinge at the hips with a Neutral Spine, pushing the hips back. Keep a neutral spine.";
            KmpMatcher m = new KmpMatcher("neutral spine");
            assertEquals(List.of(25, 70), m.findAll(text));
            assertTrue(m.matches(text));
            assertEquals(25, m.indexIn(text));
        }

        @Test
        @DisplayName("K4 [EDGE] no match, pattern longer than text, and empty/null text")
        void noMatch() {
            KmpMatcher m = new KmpMatcher("overhead");
            assertTrue(m.findAll("press the weight forward").isEmpty());
            assertTrue(m.findAll("over").isEmpty());
            assertTrue(m.findAll("").isEmpty());
            assertTrue(m.findAll(null).isEmpty());
            assertEquals(-1, m.indexIn("nothing here"));
        }

        @Test
        @DisplayName("K5 [EDGE] pattern equal to the whole text; single-character pattern")
        void wholeTextAndSingleChar() {
            assertEquals(List.of(0), new KmpMatcher("deadlift").findAll("Deadlift"));
            assertEquals(List.of(1, 3), new KmpMatcher("a").findAll("bacat"));
        }

        @Test
        @DisplayName("K6 [EDGE] empty pattern is rejected")
        void emptyPattern() {
            assertThrows(IllegalArgumentException.class, () -> new KmpMatcher(""));
            assertThrows(IllegalArgumentException.class, () -> new KmpMatcher(null));
        }

        @Test
        @DisplayName("K7 property: KMP agrees with naive matcher on 3,000 random text/pattern pairs")
        void agreesWithNaive() {
            Random rnd = new Random(11);
            NaiveMatcher naive = new NaiveMatcher();
            for (int i = 0; i < 3000; i++) {
                String text = randomString(rnd, rnd.nextInt(60), "ab");
                String pat = randomString(rnd, 1 + rnd.nextInt(5), "ab");
                assertEquals(naive.findAll(text, pat), new KmpMatcher(pat).findAll(text), text + " / " + pat);
            }
        }

        @Test
        @DisplayName("K8 complexity: KMP does at most 2n comparisons; naive does far more on adversarial input")
        void linearComparisons() {
            String text = "a".repeat(10_000) + "b";
            String pat = "a".repeat(50) + "b";
            KmpMatcher kmp = new KmpMatcher(pat);
            kmp.findAll(text);
            assertTrue(kmp.lastComparisons() <= 2L * text.length(), "kmp comparisons " + kmp.lastComparisons());
            NaiveMatcher naive = new NaiveMatcher();
            naive.findAll(text, pat);
            assertTrue(naive.lastComparisons() > 20L * kmp.lastComparisons());
        }

        private String randomString(Random rnd, int len, String alphabet) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < len; i++) sb.append(alphabet.charAt(rnd.nextInt(alphabet.length())));
            return sb.toString();
        }
    }
}
