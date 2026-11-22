package com.exsub.engine;

import com.exsub.algo.Trie;
import com.exsub.model.Exercise;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * In-memory catalog plus its search structures:
 * <ul>
 *   <li>{@code nameTrie} — every exercise name AND every word-suffix of it ("barbell bench press",
 *       "bench press", "press"), so typing any word of a name autocompletes;</li>
 *   <li>{@code tagTrie} — tags, muscles, equipment and movement patterns → exercises;</li>
 *   <li>{@code primaryMuscleIndex} — candidate generation for substitution (plain HashMap,
 *       supporting infrastructure only).</li>
 * </ul>
 */
public final class CatalogIndex {

    private final List<Exercise> exercises;
    private final Map<String, Exercise> byId = new HashMap<>();
    private final Trie nameTrie = new Trie();
    private final Trie tagTrie = new Trie();
    private final Map<String, List<Integer>> primaryMuscleIndex = new HashMap<>();

    public CatalogIndex(List<Exercise> exercises) {
        this.exercises = List.copyOf(exercises);
        for (Exercise ex : this.exercises) {
            byId.put(ex.id().toLowerCase(), ex);
            indexName(ex);
            for (String t : ex.tags()) tagTrie.insert(t, ex.index());
            for (String m : ex.primaryMuscles()) tagTrie.insert(m, ex.index());
            for (String m : ex.secondaryMuscles()) tagTrie.insert(m, ex.index());
            for (String e : ex.equipment()) tagTrie.insert(e, ex.index());
            tagTrie.insert(ex.movementPattern(), ex.index());
            for (String m : ex.primaryMuscles()) {
                primaryMuscleIndex.computeIfAbsent(m, k -> new ArrayList<>()).add(ex.index());
            }
        }
    }

    private void indexName(Exercise ex) {
        String n = Trie.normalize(ex.name());
        nameTrie.insert(n, ex.index());
        // also index from each word boundary so "press" finds "Barbell Bench Press"
        for (int i = 0; i < n.length(); i++) {
            char prev = i == 0 ? ' ' : n.charAt(i - 1);
            if (i > 0 && (prev == ' ' || prev == '-')) nameTrie.insert(n.substring(i), ex.index());
        }
    }

    public boolean isEmpty() { return exercises.isEmpty(); }
    public int size() { return exercises.size(); }
    public List<Exercise> all() { return exercises; }
    public Exercise get(int index) { return exercises.get(index); }
    public Exercise byId(String id) { return id == null ? null : byId.get(id.toLowerCase()); }
    public Trie nameTrie() { return nameTrie; }
    public Trie tagTrie() { return tagTrie; }

    /** Exact full-name lookup via the trie, filtering out word-suffix aliases. */
    public Exercise byExactName(String name) {
        String n = Trie.normalize(name);
        for (Integer idx : nameTrie.getExact(n)) {
            Exercise ex = exercises.get(idx);
            if (Trie.normalize(ex.name()).equals(n)) return ex;
        }
        return null;
    }

    /** Exercises sharing at least one primary muscle with {@code target}, excluding it. */
    public List<Exercise> candidatesFor(Exercise target) {
        Set<Integer> ids = new LinkedHashSet<>();
        for (String m : target.primaryMuscles()) {
            ids.addAll(primaryMuscleIndex.getOrDefault(m, Collections.emptyList()));
        }
        ids.remove(target.index());
        List<Exercise> out = new ArrayList<>(ids.size());
        for (Integer i : ids) out.add(exercises.get(i));
        return out;
    }
}
