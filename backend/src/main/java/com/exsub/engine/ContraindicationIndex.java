package com.exsub.engine;

import com.exsub.algo.BloomFilter;
import com.exsub.model.Exercise;
import com.exsub.model.InjuryRule;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Pre-computes every contraindicated (exercise, injury-tag) pair by running the rule engine
 * over the whole catalog once at load time, and stores those pairs in a {@link BloomFilter}.
 *
 * <p>An exact {@link HashSet} of the same pairs is also kept, but ONLY for the benchmark
 * baseline and for measuring the empirical false-positive rate — the request path confirms
 * Bloom positives by re-running the authoritative {@link RuleEngine}, which also yields the
 * human-readable reason.
 */
public final class ContraindicationIndex {

    private final BloomFilter bloom;
    private final Set<String> exactPairs;
    private final Map<String, Integer> pairsPerInjury;

    private ContraindicationIndex(BloomFilter bloom, Set<String> exactPairs, Map<String, Integer> perInjury) {
        this.bloom = bloom;
        this.exactPairs = exactPairs;
        this.pairsPerInjury = perInjury;
    }

    public static String key(String exerciseId, String injuryTag) {
        return exerciseId + "|" + injuryTag;
    }

    /** Builds a filter sized for the actual number of pairs at target FPP {@code fpp}. */
    public static ContraindicationIndex build(List<Exercise> catalog, RuleEngine engine, double fpp) {
        Map<String, Integer> perInjury = new TreeMap<>();
        List<String> pairs = computePairs(catalog, engine, perInjury);
        BloomFilter bloom = BloomFilter.create(Math.max(1, pairs.size()), fpp);
        return fill(bloom, pairs, perInjury);
    }

    /** Builds with a caller-supplied filter (tests use a deliberately tiny/saturated one). */
    public static ContraindicationIndex buildWithFilter(List<Exercise> catalog, RuleEngine engine, BloomFilter bloom) {
        Map<String, Integer> perInjury = new TreeMap<>();
        return fill(bloom, computePairs(catalog, engine, perInjury), perInjury);
    }

    /** Runs the rule engine over catalog × injuries once: O(N · R · C). */
    private static List<String> computePairs(List<Exercise> catalog, RuleEngine engine, Map<String, Integer> perInjury) {
        List<String> pairs = new ArrayList<>();
        for (InjuryRule rule : engine.rules()) {
            int count = 0;
            for (Exercise ex : catalog) {
                if (!engine.evaluate(ex, rule.tag()).isEmpty()) {
                    pairs.add(key(ex.id(), rule.tag()));
                    count++;
                }
            }
            perInjury.put(rule.tag(), count);
        }
        return pairs;
    }

    private static ContraindicationIndex fill(BloomFilter bloom, List<String> pairs, Map<String, Integer> perInjury) {
        Set<String> exact = new HashSet<>(pairs);
        for (String p : pairs) bloom.add(p);
        return new ContraindicationIndex(bloom, exact, perInjury);
    }

    /** Fast pre-check. false => definitely safe; true => POSSIBLY unsafe, must confirm. */
    public boolean possiblyContraindicated(String exerciseId, String injuryTag) {
        return bloom.mightContain(key(exerciseId, injuryTag));
    }

    /** Exact-set lookup (baseline / evaluation only). */
    public boolean exactContains(String exerciseId, String injuryTag) {
        return exactPairs.contains(key(exerciseId, injuryTag));
    }

    /**
     * Empirical false-positive rate: query every (exercise, injury) pair that is NOT
     * contraindicated and count how many the filter wrongly reports as possibly present.
     */
    public double measuredFalsePositiveRate(List<Exercise> catalog, Iterable<String> injuryTags) {
        long negatives = 0, fps = 0;
        for (String tag : injuryTags) {
            for (Exercise ex : catalog) {
                String k = key(ex.id(), tag);
                if (exactPairs.contains(k)) continue;
                negatives++;
                if (bloom.mightContain(k)) fps++;
            }
        }
        return negatives == 0 ? 0.0 : (double) fps / negatives;
    }

    public BloomFilter bloom() { return bloom; }
    public int pairCount() { return exactPairs.size(); }
    public Map<String, Integer> pairsPerInjury() { return pairsPerInjury; }
}
