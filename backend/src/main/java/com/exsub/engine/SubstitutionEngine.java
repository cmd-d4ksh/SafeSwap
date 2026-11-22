package com.exsub.engine;

import com.exsub.algo.KmpMatcher;
import com.exsub.algo.Trie;
import com.exsub.engine.SubstitutionResult.Candidate;
import com.exsub.engine.SubstitutionResult.Rejection;
import com.exsub.engine.SubstitutionResult.SafetyMethod;
import com.exsub.engine.SubstitutionResult.ScoreBreakdown;
import com.exsub.error.ApiException;
import com.exsub.model.Exercise;
import com.exsub.model.InjuryRule;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Core business logic (pure Java, no Spring): validates input, resolves the target exercise
 * through the trie, generates same-muscle candidates, runs the Bloom pre-check, CONFIRMS every
 * Bloom positive with the authoritative {@link RuleEngine}, optionally KMP-matches a keyword
 * against instruction text, then scores and ranks the safe candidates.
 */
public final class SubstitutionEngine {

    static final double W_PRIMARY = 0.45;
    static final double W_SECONDARY = 0.15;
    static final double W_PATTERN = 0.20;
    static final double W_EQUIPMENT = 0.10;
    static final double W_KEYWORD = 0.10;
    public static final int MAX_RESULTS_LIMIT = 50;

    private final CatalogIndex catalog;
    private final RuleEngine rules;
    private final ContraindicationIndex contraindications;

    public SubstitutionEngine(CatalogIndex catalog, RuleEngine rules, ContraindicationIndex contraindications) {
        this.catalog = catalog;
        this.rules = rules;
        this.contraindications = contraindications;
    }

    public SubstitutionResult substitute(SubstitutionRequest req) {
        long t0 = System.nanoTime();
        if (catalog.isEmpty()) throw ApiException.catalogEmpty();
        validate(req);

        // 1) resolve target exercise (id, exact name via trie, or unique trie prefix)
        String[] resolvedBy = new String[1];
        Exercise target = resolveTarget(req.exercise().trim(), resolvedBy);
        InjuryRule injury = rules.rule(req.injuryTag().trim());
        List<String> targetViolations = rules.evaluate(target, injury.tag());

        // 2) optional keyword -> compile KMP once, reuse for every candidate
        String keyword = req.keyword() == null ? "" : req.keyword().trim();
        KmpMatcher kmp = keyword.isEmpty() ? null : new KmpMatcher(Trie.normalize(keyword));

        List<Exercise> candidates = catalog.candidatesFor(target);
        Set<String> targetEquipment = new HashSet<>(target.equipment());

        List<Candidate> accepted = new ArrayList<>();
        List<Rejection> rejected = new ArrayList<>();
        int bloomNeg = 0, bloomPos = 0, confirmed = 0, cleared = 0, filtered = 0;
        long kmpComparisons = 0;

        for (Exercise c : candidates) {
            // 3) Bloom pre-check — a negative is definitive, a positive is only "possibly"
            SafetyMethod method;
            String safetyExplanation;
            if (!contraindications.possiblyContraindicated(c.id(), injury.tag())) {
                bloomNeg++;
                method = SafetyMethod.BLOOM_NEGATIVE;
                safetyExplanation = "Bloom filter: (" + c.id() + ", " + injury.tag()
                        + ") definitely NOT in contraindicated set (Bloom filters have no false negatives); rule evaluation skipped.";
            } else {
                bloomPos++;
                // 4) authoritative confirmation — never report unsafe on a Bloom hit alone
                List<String> violations = rules.evaluate(c, injury.tag());
                if (!violations.isEmpty()) {
                    confirmed++;
                    rejected.add(new Rejection(c.id(), c.name(), "SAFETY",
                            SafetyMethod.BLOOM_POSITIVE_RULE_CONFIRMED, violations));
                    continue;
                }
                cleared++;
                method = SafetyMethod.BLOOM_POSITIVE_RULE_CLEARED;
                safetyExplanation = "Bloom filter said 'possibly contraindicated' but the exact rule check found no violation "
                        + "— a Bloom false positive, so the exercise is SAFE.";
            }

            // 5) user filters
            if (req.sameEquipmentOnlyOrDefault() && disjoint(targetEquipment, c.equipment())) {
                filtered++;
                rejected.add(new Rejection(c.id(), c.name(), "FILTER", method,
                        List.of("Does not share equipment with target (" + String.join(", ", target.equipment()) + ")")));
                continue;
            }
            List<Integer> positions = List.of();
            if (kmp != null) {
                positions = kmp.findAll(c.instructions());
                kmpComparisons += kmp.lastComparisons();
                if (positions.isEmpty() && req.requireKeywordOrDefault()) {
                    filtered++;
                    rejected.add(new Rejection(c.id(), c.name(), "FILTER", method,
                            List.of("Instruction text does not contain \"" + keyword + "\" (KMP, required)")));
                    continue;
                }
            }

            // 6) score
            double primary = jaccard(target.primaryMuscles(), c.primaryMuscles());
            double secondary = jaccard(target.secondaryMuscles(), c.secondaryMuscles());
            double pattern = target.movementPattern().equals(c.movementPattern()) ? 1.0 : 0.0;
            double equip = disjoint(targetEquipment, c.equipment()) ? 0.0 : 1.0;
            double kw = positions.isEmpty() ? 0.0 : 1.0;
            ScoreBreakdown b = new ScoreBreakdown(round(W_PRIMARY * primary), round(W_SECONDARY * secondary),
                    round(W_PATTERN * pattern), round(W_EQUIPMENT * equip), round(W_KEYWORD * kw));
            double score = round(b.primaryOverlap() + b.secondaryOverlap() + b.movementPattern() + b.equipment() + b.keyword());

            List<String> because = new ArrayList<>();
            List<String> shared = intersection(target.primaryMuscles(), c.primaryMuscles());
            because.add("Targets same primary muscle(s): " + String.join(", ", shared));
            if (pattern > 0) because.add("Same movement pattern (" + c.movementPattern() + ")");
            if (equip > 0) because.add("Shares equipment with target");
            if (kw > 0) because.add("Instructions contain \"" + keyword + "\" (KMP match at " + positions + ")");
            because.add("Safe for " + injury.tag() + " via " + method);

            accepted.add(new Candidate(0, c.id(), c.name(), score, b, c.primaryMuscles(), c.secondaryMuscles(),
                    c.equipment(), c.movementPattern(), method, safetyExplanation, positions,
                    positions.isEmpty() ? null : snippet(c.instructions(), positions.get(0), kmp.patternLength()),
                    because));
        }

        accepted.sort(Comparator.comparingDouble(Candidate::score).reversed().thenComparing(Candidate::name));
        int limit = req.maxResultsOrDefault();
        List<Candidate> ranked = new ArrayList<>();
        for (int i = 0; i < Math.min(limit, accepted.size()); i++) {
            Candidate c = accepted.get(i);
            ranked.add(new Candidate(i + 1, c.id(), c.name(), c.score(), c.breakdown(), c.primaryMuscles(),
                    c.secondaryMuscles(), c.equipment(), c.movementPattern(), c.safetyMethod(),
                    c.safetyExplanation(), c.keywordMatchPositions(), c.keywordSnippet(), c.acceptedBecause()));
        }

        SubstitutionResult.Status status;
        String message;
        if (ranked.isEmpty()) {
            status = SubstitutionResult.Status.NO_SAFE_SUBSTITUTE;
            if (candidates.isEmpty()) {
                message = "No other exercise in the catalog targets " + String.join(", ", target.primaryMuscles())
                        + " as a primary muscle, so no substitute exists.";
            } else if (confirmed == candidates.size()) {
                message = "All " + candidates.size() + " exercises targeting " + String.join(", ", target.primaryMuscles())
                        + " are contraindicated for " + injury.name()
                        + ". No safe substitute exists in the catalog — consult a physiotherapist.";
            } else {
                message = "No candidate passed both the safety check and your filters (" + confirmed
                        + " unsafe, " + filtered + " filtered out). Try relaxing the filters.";
            }
        } else {
            status = SubstitutionResult.Status.OK;
            message = ranked.size() + " safe substitute(s) found from " + candidates.size() + " same-muscle candidates ("
                    + confirmed + " rejected as unsafe after rule confirmation).";
        }

        long micros = (System.nanoTime() - t0) / 1_000;
        return new SubstitutionResult(status, message,
                new SubstitutionResult.Target(target.id(), target.name(), resolvedBy[0], target.primaryMuscles(),
                        target.equipment(), target.movementPattern(), !targetViolations.isEmpty(), targetViolations),
                new SubstitutionResult.Injury(injury.tag(), injury.name(), injury.guidance()),
                new SubstitutionResult.Parameters(limit, keyword.isEmpty() ? null : keyword,
                        req.requireKeywordOrDefault(), req.sameEquipmentOnlyOrDefault()),
                ranked, rejected,
                new SubstitutionResult.PipelineStats(
                        resolvedBy[0],
                        "Primary-muscle index (" + candidates.size() + " candidates)",
                        "Bloom filter pre-check (m=" + contraindications.bloom().bitSize() + " bits, k="
                                + contraindications.bloom().hashCount() + ") + exact rule-engine confirmation of every positive",
                        kmp == null ? "none" : "KMP over instruction text (pattern length " + kmp.patternLength() + ")",
                        candidates.size(), bloomNeg, bloomPos, confirmed, cleared, bloomPos, bloomNeg, filtered,
                        kmpComparisons, micros));
    }

    private void validate(SubstitutionRequest req) {
        if (req == null || req.exercise() == null || req.exercise().isBlank()) {
            throw ApiException.badRequest("EXERCISE_REQUIRED", "Field 'exercise' (name or id) is required.", List.of());
        }
        if (req.injuryTag() == null || req.injuryTag().isBlank()) {
            throw ApiException.badRequest("INJURY_REQUIRED", "Field 'injuryTag' is required.", knownTags());
        }
        if (!rules.isKnownInjury(req.injuryTag().trim())) {
            throw ApiException.badRequest("UNKNOWN_INJURY_TAG",
                    "Unknown injury tag '" + req.injuryTag() + "'. Use one of the listed tags.", knownTags());
        }
        int max = req.maxResultsOrDefault();
        if (max < 1 || max > MAX_RESULTS_LIMIT) {
            throw ApiException.badRequest("INVALID_MAX_RESULTS",
                    "maxResults must be between 1 and " + MAX_RESULTS_LIMIT + " (got " + max + ").", List.of());
        }
        if (req.requireKeywordOrDefault() && (req.keyword() == null || req.keyword().isBlank())) {
            throw ApiException.badRequest("KEYWORD_REQUIRED",
                    "requireKeyword is true but no keyword was given.", List.of());
        }
    }

    private List<String> knownTags() {
        List<String> tags = new ArrayList<>();
        for (InjuryRule r : rules.rules()) tags.add(r.tag());
        return tags;
    }

    private Exercise resolveTarget(String input, String[] resolvedBy) {
        Exercise byId = catalog.byId(input);
        if (byId != null) {
            resolvedBy[0] = "ID lookup";
            return byId;
        }
        Exercise exact = catalog.byExactName(input);
        if (exact != null) {
            resolvedBy[0] = "Trie exact-name match";
            return exact;
        }
        Trie.SearchResult prefix = catalog.nameTrie().searchPrefix(input, 50);
        List<Integer> ids = prefix.distinctIds(50);
        if (ids.size() == 1) {
            resolvedBy[0] = "Trie unique-prefix match";
            return catalog.get(ids.get(0));
        }
        List<String> suggestions = new ArrayList<>();
        for (int i = 0; i < Math.min(8, ids.size()); i++) suggestions.add(catalog.get(ids.get(i)).name());
        if (suggestions.isEmpty()) {
            // fall back to suggestions for the first word
            String first = Trie.normalize(input).split(" ")[0];
            for (Integer id : catalog.nameTrie().searchPrefix(first, 8).distinctIds(8)) {
                suggestions.add(catalog.get(id).name());
            }
        }
        if (ids.size() > 1) {
            throw ApiException.badRequest("AMBIGUOUS_EXERCISE",
                    "'" + input + "' matches " + ids.size() + (ids.size() == 50 ? "+" : "")
                            + " exercises; pick one exact name.", suggestions);
        }
        throw ApiException.notFound("EXERCISE_NOT_FOUND", "No exercise named '" + input + "' in the catalog.", suggestions);
    }

    static double jaccard(List<String> a, List<String> b) {
        if (a.isEmpty() && b.isEmpty()) return 0.0;
        Set<String> union = new HashSet<>(a);
        union.addAll(b);
        int inter = intersection(a, b).size();
        return (double) inter / union.size();
    }

    private static List<String> intersection(List<String> a, List<String> b) {
        List<String> out = new ArrayList<>();
        for (String x : a) if (b.contains(x) && !out.contains(x)) out.add(x);
        return out;
    }

    private static boolean disjoint(Set<String> a, List<String> b) {
        for (String x : b) if (a.contains(x)) return false;
        return true;
    }

    private static double round(double v) { return Math.round(v * 1000.0) / 1000.0; }

    private static String snippet(String text, int pos, int len) {
        int from = Math.max(0, pos - 30);
        int to = Math.min(text.length(), pos + len + 30);
        return (from > 0 ? "…" : "") + text.substring(from, pos) + "[" + text.substring(pos, pos + len) + "]"
                + text.substring(pos + len, to) + (to < text.length() ? "…" : "");
    }
}
