package com.exsub.algo;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Hand-written prefix tree (trie).
 *
 * <p>Each node owns a child map keyed by character. A {@link TreeMap} is used purely as the
 * child container so that a depth-first traversal yields keys in lexicographic order; the
 * trie logic itself (insertion, prefix walk, subtree collection) is implemented here.
 *
 * <p>Keys are normalised (trimmed, lower-cased, internal whitespace collapsed). A terminal
 * node stores the set of payload ids attached to that key, so several exercises may share a key
 * (e.g. the tag "overhead").
 *
 * <p>Complexity (L = key length, P = prefix length, S = size of the matched subtree):
 * insert O(L); exact lookup O(L); prefix search O(P + S) — independent of catalog size N
 * when the prefix is selective.
 */
public final class Trie {

    private static final class Node {
        final Map<Character, Node> children = new TreeMap<>();
        /** Non-null only on terminal nodes. */
        Set<Integer> ids;
        /** Full key stored on terminal nodes for O(1) reconstruction during collection. */
        String key;
    }

    /** One terminal key reached during a prefix search, with the ids stored under it. */
    public record Match(String key, List<Integer> ids) { }

    /** Result of a prefix search plus the number of trie nodes touched (for the "method used" panel). */
    public record SearchResult(List<Match> matches, int nodesVisited) {
        public List<Integer> distinctIds(int limit) {
            Set<Integer> out = new LinkedHashSet<>();
            for (Match m : matches) {
                for (Integer id : m.ids()) {
                    if (out.size() >= limit) return new ArrayList<>(out);
                    out.add(id);
                }
            }
            return new ArrayList<>(out);
        }
    }

    private final Node root = new Node();
    private int keyCount;
    private int nodeCount = 1;

    public static String normalize(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length());
        boolean lastSpace = true; // drops leading whitespace
        for (int i = 0; i < s.length(); i++) {
            char c = Character.toLowerCase(s.charAt(i));
            if (Character.isWhitespace(c)) {
                if (!lastSpace) sb.append(' ');
                lastSpace = true;
            } else {
                sb.append(c);
                lastSpace = false;
            }
        }
        int len = sb.length();
        if (len > 0 && sb.charAt(len - 1) == ' ') sb.setLength(len - 1);
        return sb.toString();
    }

    /** Inserts {@code key -> id}. Re-inserting the same pair is a no-op. */
    public void insert(String key, int id) {
        String k = normalize(key);
        if (k.isEmpty()) throw new IllegalArgumentException("Trie key must not be blank");
        Node cur = root;
        for (int i = 0; i < k.length(); i++) {
            char c = k.charAt(i);
            Node next = cur.children.get(c);
            if (next == null) {
                next = new Node();
                cur.children.put(c, next);
                nodeCount++;
            }
            cur = next;
        }
        if (cur.ids == null) {
            cur.ids = new LinkedHashSet<>();
            cur.key = k;
            keyCount++;
        }
        cur.ids.add(id);
    }

    /** Walks the trie along {@code prefix}; returns the node reached or null. */
    private Node walk(String normalizedPrefix) {
        Node cur = root;
        for (int i = 0; i < normalizedPrefix.length() && cur != null; i++) {
            cur = cur.children.get(normalizedPrefix.charAt(i));
        }
        return cur;
    }

    /** Ids stored under exactly {@code key}; empty if the key is absent. */
    public List<Integer> getExact(String key) {
        String k = normalize(key);
        if (k.isEmpty()) return Collections.emptyList();
        Node n = walk(k);
        return (n == null || n.ids == null) ? Collections.emptyList() : new ArrayList<>(n.ids);
    }

    public boolean containsKey(String key) {
        String k = normalize(key);
        if (k.isEmpty()) return false;
        Node n = walk(k);
        return n != null && n.ids != null;
    }

    public boolean hasPrefix(String prefix) {
        return walk(normalize(prefix)) != null;
    }

    /**
     * Returns up to {@code limit} terminal keys under {@code prefix}, in lexicographic order.
     * An empty prefix matches every key.
     */
    public SearchResult searchPrefix(String prefix, int limit) {
        if (limit <= 0) return new SearchResult(Collections.emptyList(), 0);
        String p = normalize(prefix);
        Node start = walk(p);
        int[] visited = {p.length()};
        List<Match> out = new ArrayList<>();
        if (start != null) collect(start, out, limit, visited);
        return new SearchResult(out, visited[0]);
    }

    /** Depth-first, pre-order collection; stops as soon as {@code limit} keys are found. */
    private void collect(Node node, List<Match> out, int limit, int[] visited) {
        visited[0]++;
        if (node.ids != null) {
            out.add(new Match(node.key, new ArrayList<>(node.ids)));
            if (out.size() >= limit) return;
        }
        for (Node child : node.children.values()) {
            if (out.size() >= limit) return;
            collect(child, out, limit, visited);
        }
    }

    public int keyCount() { return keyCount; }
    public int nodeCount() { return nodeCount; }
    public boolean isEmpty() { return keyCount == 0; }
}
