package com.exsub.algo.baseline;

import com.exsub.algo.Trie;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;

/**
 * Baseline for the trie: keeps (key, id) pairs in a flat list and answers a prefix query by
 * scanning every key — O(N·P) per query. Returns the same key ordering as the trie so the two
 * can be compared for equality in tests.
 */
public final class LinearPrefixScan {

    private final List<String> keys = new ArrayList<>();
    private final List<Integer> ids = new ArrayList<>();

    public void insert(String key, int id) {
        keys.add(Trie.normalize(key));
        ids.add(id);
    }

    /** Distinct matching keys in lexicographic order, at most {@code limit}. */
    public List<String> searchPrefixKeys(String prefix, int limit) {
        String p = Trie.normalize(prefix);
        TreeMap<String, Boolean> hits = new TreeMap<>();
        for (String k : keys) {
            if (startsWith(k, p)) hits.put(k, Boolean.TRUE);
        }
        List<String> out = new ArrayList<>();
        for (String k : hits.keySet()) {
            if (out.size() >= limit) break;
            out.add(k);
        }
        return out;
    }

    /** Count of matching (key,id) pairs — what a naive autocomplete does per keystroke. */
    public int countMatches(String prefix) {
        String p = Trie.normalize(prefix);
        int c = 0;
        for (String k : keys) if (startsWith(k, p)) c++;
        return c;
    }

    private static boolean startsWith(String s, String p) {
        if (p.length() > s.length()) return false;
        for (int i = 0; i < p.length(); i++) if (s.charAt(i) != p.charAt(i)) return false;
        return true;
    }

    public int size() { return keys.size(); }
}
