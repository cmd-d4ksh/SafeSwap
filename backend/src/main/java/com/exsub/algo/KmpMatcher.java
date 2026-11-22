package com.exsub.algo;

import java.util.ArrayList;
import java.util.List;

/**
 * Hand-written Knuth–Morris–Pratt matcher.
 *
 * <p>The pattern is compiled once into its failure function (a.k.a. LPS / prefix function):
 * {@code lps[i]} = length of the longest proper prefix of {@code pattern[0..i]} that is also a
 * suffix of it. Searching then never moves backwards in the text, giving O(n + m) time
 * (at most 2n character comparisons for the scan) versus O(n·m) for the naive matcher.
 *
 * <p>Matching is case-insensitive: both pattern and text are compared lower-cased.
 * A compiled matcher is immutable and can be reused across many texts (we compile the user's
 * keyword once and scan every candidate's instruction text with it).
 */
public final class KmpMatcher {

    private final char[] pattern;
    private final int[] lps;
    private long lastComparisons;

    public KmpMatcher(String pattern) {
        if (pattern == null || pattern.isEmpty()) {
            throw new IllegalArgumentException("KMP pattern must not be empty");
        }
        this.pattern = pattern.toLowerCase().toCharArray();
        this.lps = buildFailureFunction(this.pattern);
    }

    /** Builds the failure (LPS) table in O(m). */
    public static int[] buildFailureFunction(char[] p) {
        int[] lps = new int[p.length];
        int len = 0; // length of the current longest prefix-suffix
        int i = 1;
        while (i < p.length) {
            if (p[i] == p[len]) {
                lps[i++] = ++len;
            } else if (len > 0) {
                len = lps[len - 1]; // fall back, do not advance i
            } else {
                lps[i++] = 0;
            }
        }
        return lps;
    }

    public static int[] buildFailureFunction(String p) {
        return buildFailureFunction(p.toLowerCase().toCharArray());
    }

    /** All start indices (0-based) where the pattern occurs in {@code text}, overlaps included. */
    public List<Integer> findAll(String text) {
        List<Integer> hits = new ArrayList<>();
        scan(text, hits, false);
        return hits;
    }

    /** True if the pattern occurs at least once; stops at the first hit. */
    public boolean matches(String text) {
        return scan(text, null, true) >= 0;
    }

    /** First occurrence or -1. */
    public int indexIn(String text) {
        return scan(text, null, true);
    }

    private int scan(String text, List<Integer> hits, boolean stopAtFirst) {
        long comparisons = 0;
        int first = -1;
        if (text != null && text.length() >= pattern.length) {
            int m = pattern.length;
            int j = 0; // chars of pattern matched so far
            for (int i = 0; i < text.length(); i++) {
                char c = Character.toLowerCase(text.charAt(i));
                while (j > 0 && c != pattern[j]) {
                    comparisons++;
                    j = lps[j - 1];
                }
                comparisons++;
                if (c == pattern[j]) j++;
                if (j == m) {
                    int start = i - m + 1;
                    if (first < 0) first = start;
                    if (hits != null) hits.add(start);
                    if (stopAtFirst) break;
                    j = lps[j - 1]; // continue to find overlapping matches
                }
            }
        }
        lastComparisons = comparisons;
        return first;
    }

    /** Character comparisons performed by the most recent search (instrumentation for reports). */
    public long lastComparisons() { return lastComparisons; }

    public int patternLength() { return pattern.length; }
}
