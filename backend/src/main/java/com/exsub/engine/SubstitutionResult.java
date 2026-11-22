package com.exsub.engine;

import java.util.List;

/** Fully interpretable result of a substitution search. Serialised as-is to JSON. */
public record SubstitutionResult(
        Status status,
        String message,
        Target target,
        Injury injury,
        Parameters parameters,
        List<Candidate> results,
        List<Rejection> rejected,
        PipelineStats pipeline) {

    public enum Status { OK, NO_SAFE_SUBSTITUTE }

    /** How the safety verdict for a candidate was reached. */
    public enum SafetyMethod {
        /** Bloom filter said "definitely not contraindicated" — no rule evaluation needed. */
        BLOOM_NEGATIVE,
        /** Bloom filter said "possibly contraindicated", exact rule check found NO violation (false positive). */
        BLOOM_POSITIVE_RULE_CLEARED,
        /** Bloom filter said "possibly contraindicated", exact rule check CONFIRMED violations. */
        BLOOM_POSITIVE_RULE_CONFIRMED
    }

    public record Target(String id, String name, String resolvedBy, List<String> primaryMuscles,
                         List<String> equipment, String movementPattern,
                         boolean unsafeForInjury, List<String> unsafeReasons) { }

    public record Injury(String tag, String name, String guidance) { }

    public record Parameters(int maxResults, String keyword, boolean requireKeyword, boolean sameEquipmentOnly) { }

    public record ScoreBreakdown(double primaryOverlap, double secondaryOverlap, double movementPattern,
                                 double equipment, double keyword) { }

    public record Candidate(int rank, String id, String name, double score, ScoreBreakdown breakdown,
                            List<String> primaryMuscles, List<String> secondaryMuscles, List<String> equipment,
                            String movementPattern, SafetyMethod safetyMethod, String safetyExplanation,
                            List<Integer> keywordMatchPositions, String keywordSnippet,
                            List<String> acceptedBecause) { }

    public record Rejection(String id, String name, String stage, SafetyMethod safetyMethod, List<String> reasons) { }

    public record PipelineStats(String targetLookup, String candidateGeneration, String safetyCheck,
                                String keywordMatching, int candidatesConsidered, int bloomNegatives,
                                int bloomPositives, int confirmedUnsafe, int falsePositivesCleared,
                                int ruleEvaluations, int ruleEvaluationsAvoided, int filteredOut,
                                long kmpComparisons, long elapsedMicros) { }
}
