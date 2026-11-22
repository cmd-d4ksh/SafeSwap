package com.exsub.algo.baseline;

import java.util.ArrayList;
import java.util.List;

/** Baseline: brute-force O(n·m) substring search, case-insensitive. Used only for comparison. */
public final class NaiveMatcher {

    private long lastComparisons;

    public List<Integer> findAll(String text, String pattern) {
        if (pattern == null || pattern.isEmpty()) throw new IllegalArgumentException("pattern must not be empty");
        String t = text.toLowerCase();
        String p = pattern.toLowerCase();
        List<Integer> hits = new ArrayList<>();
        long comparisons = 0;
        for (int i = 0; i + p.length() <= t.length(); i++) {
            int j = 0;
            while (j < p.length()) {
                comparisons++;
                if (t.charAt(i + j) != p.charAt(j)) break;
                j++;
            }
            if (j == p.length()) hits.add(i);
        }
        lastComparisons = comparisons;
        return hits;
    }

    public boolean matches(String text, String pattern) {
        return !findAll(text, pattern).isEmpty();
    }

    public long lastComparisons() { return lastComparisons; }
}
