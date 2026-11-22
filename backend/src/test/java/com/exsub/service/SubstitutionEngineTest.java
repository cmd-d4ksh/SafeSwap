package com.exsub.service;

import com.exsub.algo.BloomFilter;
import com.exsub.data.CatalogLoader;
import com.exsub.data.CatalogLoader.RawExercise;
import com.exsub.data.ExerciseCatalogGenerator;
import com.exsub.engine.CatalogIndex;
import com.exsub.engine.ContraindicationIndex;
import com.exsub.engine.RuleEngine;
import com.exsub.engine.SubstitutionEngine;
import com.exsub.engine.SubstitutionRequest;
import com.exsub.engine.SubstitutionResult;
import com.exsub.engine.SubstitutionResult.SafetyMethod;
import com.exsub.error.ApiException;
import com.exsub.model.Exercise;
import com.exsub.model.InjuryRule;
import com.exsub.model.InjuryRule.Contraindication;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Workflow + data-validation tests for the substitution engine (Bloom pre-check + rule confirmation). */
class SubstitutionEngineTest {

    static List<InjuryRule> rules;
    static CatalogService.Snapshot real;

    @BeforeAll
    static void loadRealData() throws Exception {
        try (InputStream in = SubstitutionEngineTest.class.getResourceAsStream("/data/injury_rules.json")) {
            rules = new ObjectMapper().readValue(in, new TypeReference<List<InjuryRule>>() { });
        }
        real = CatalogService.build(ExerciseCatalogGenerator.realistic(), rules, 0.01, null, 0);
    }

    private static RawExercise raw(String id, String name, String muscle, String pattern, List<String> tags) {
        return new RawExercise(id, name, List.of(muscle), List.of(), List.of("dumbbell"), pattern, tags,
                "Keep a neutral spine and move with control.");
    }

    private static SubstitutionRequest req(String exercise, String injury) {
        return new SubstitutionRequest(exercise, injury, 10, null, null, null);
    }

    @Test
    @DisplayName("S1 happy path: back squat + lower-back strain returns ranked, rule-verified safe quads/glutes work")
    void happyPath() {
        SubstitutionResult r = real.engine().substitute(req("Barbell Back Squat", "lower-back-strain"));
        assertEquals(SubstitutionResult.Status.OK, r.status());
        assertTrue(r.target().unsafeForInjury(), "barbell back squat is axially loaded");
        assertFalse(r.results().isEmpty());
        double prev = Double.MAX_VALUE;
        for (SubstitutionResult.Candidate c : r.results()) {
            assertTrue(c.score() <= prev, "sorted by score desc");
            prev = c.score();
            Exercise ex = real.catalog().byId(c.id());
            assertTrue(real.rules().evaluate(ex, "lower-back-strain").isEmpty(), c.name() + " must be truly safe");
        }
        assertFalse(r.rejected().isEmpty());
        assertEquals(r.pipeline().bloomPositives(), r.pipeline().confirmedUnsafe() + r.pipeline().falsePositivesCleared());
    }

    @Test
    @DisplayName("S2 CRITICAL: with a saturated Bloom filter (every query positive) nothing is rejected without rule confirmation")
    void bloomPositiveAlwaysConfirmed() {
        CatalogLoader.Result loaded = CatalogLoader.load(ExerciseCatalogGenerator.realistic());
        RuleEngine engine = new RuleEngine(rules);
        ContraindicationIndex saturated = ContraindicationIndex.buildWithFilter(
                loaded.exercises(), engine, BloomFilter.withSize(8, 1)); // 8 bits: fully saturated
        CatalogIndex catalog = new CatalogIndex(loaded.exercises());
        SubstitutionResult r = new SubstitutionEngine(catalog, engine, saturated)
                .substitute(req("Barbell Back Squat", "lower-back-strain"));

        assertEquals(0, r.pipeline().bloomNegatives(), "every query is a positive when saturated");
        assertTrue(r.pipeline().falsePositivesCleared() > 0, "false positives must be cleared by the rule engine");
        for (SubstitutionResult.Candidate c : r.results()) {
            assertEquals(SafetyMethod.BLOOM_POSITIVE_RULE_CLEARED, c.safetyMethod());
        }
        for (SubstitutionResult.Rejection rej : r.rejected()) {
            assertEquals(SafetyMethod.BLOOM_POSITIVE_RULE_CONFIRMED, rej.safetyMethod());
            assertFalse(rej.reasons().isEmpty(), "a rejection must carry the confirmed rule violation");
        }
        // same safe set as the correctly-sized filter
        SubstitutionResult normal = real.engine().substitute(req("Barbell Back Squat", "lower-back-strain"));
        assertEquals(normal.results().stream().map(SubstitutionResult.Candidate::id).toList(),
                r.results().stream().map(SubstitutionResult.Candidate::id).toList());
    }

    @Test
    @DisplayName("S3 [EDGE] injury tag with zero known contraindications: all candidates bloom-negative, none rejected")
    void injuryWithZeroContraindications() {
        assertEquals(0, real.contraindications().pairsPerInjury().get("finger-pulley-strain"));
        SubstitutionResult r = real.engine().substitute(req("Barbell Deadlift", "finger-pulley-strain"));
        assertEquals(SubstitutionResult.Status.OK, r.status());
        assertEquals(0, r.pipeline().confirmedUnsafe());
        assertTrue(r.rejected().isEmpty());
        assertFalse(r.target().unsafeForInjury());
    }

    @Test
    @DisplayName("S4 [EDGE] no safe substitute exists -> explicit NO_SAFE_SUBSTITUTE status, never an empty 'OK'")
    void noSafeSubstitute() {
        List<RawExercise> rows = List.of(
                raw("A1", "Overhead Press A", "front-delts", "push", List.of("overhead")),
                raw("A2", "Overhead Press B", "front-delts", "push", List.of("overhead")),
                raw("A3", "Pike Press", "front-delts", "push", List.of("overhead")));
        CatalogService.Snapshot s = CatalogService.build(rows, rules, 0.01, null, 0);
        SubstitutionResult r = s.engine().substitute(req("Overhead Press A", "shoulder-impingement"));
        assertEquals(SubstitutionResult.Status.NO_SAFE_SUBSTITUTE, r.status());
        assertTrue(r.results().isEmpty());
        assertEquals(2, r.rejected().size());
        assertTrue(r.message().contains("No safe substitute"));
    }

    @Test
    @DisplayName("S5 [EDGE] invalid/unknown injury tag -> 400 with the list of valid tags")
    void unknownInjury() {
        ApiException e = assertThrows(ApiException.class,
                () -> real.engine().substitute(req("Barbell Back Squat", "broken-leg")));
        assertEquals(400, e.status());
        assertEquals("UNKNOWN_INJURY_TAG", e.code());
        assertTrue(e.hints().contains("lower-back-strain"));
        assertThrows(ApiException.class, () -> real.engine().substitute(req("Barbell Back Squat", " ")));
    }

    @Test
    @DisplayName("S6 [EDGE] unknown exercise -> 404 with trie suggestions; ambiguous prefix -> 400")
    void unknownAndAmbiguousExercise() {
        ApiException nf = assertThrows(ApiException.class,
                () -> real.engine().substitute(req("Barbell Moon Press", "lower-back-strain")));
        assertEquals(404, nf.status());
        assertFalse(nf.hints().isEmpty(), "should suggest names starting with 'barbell'");
        ApiException amb = assertThrows(ApiException.class,
                () -> real.engine().substitute(req("Barbell", "lower-back-strain")));
        assertEquals("AMBIGUOUS_EXERCISE", amb.code());
    }

    @Test
    @DisplayName("S7 [EDGE] empty catalog -> 503 CATALOG_EMPTY (not a silent empty success)")
    void emptyCatalog() {
        CatalogService.Snapshot s = CatalogService.build(List.of(), rules, 0.01, null, 0);
        ApiException e = assertThrows(ApiException.class,
                () -> s.engine().substitute(req("Anything", "lower-back-strain")));
        assertEquals(503, e.status());
    }

    @Test
    @DisplayName("S8 [EDGE] duplicate and invalid catalog rows are detected and reported, first occurrence kept")
    void duplicatesDetected() {
        List<RawExercise> rows = List.of(
                raw("D1", "Goblet Squat", "quads", "squat", List.of()),
                raw("D2", "  GOBLET   squat ", "quads", "squat", List.of()),
                raw("D1", "Different Name", "quads", "squat", List.of()),
                raw("D4", "Weird Move", "quads", "teleport", List.of()));
        CatalogLoader.Result r = CatalogLoader.load(rows);
        assertEquals(1, r.exercises().size());
        assertEquals(2, r.report().duplicates().size());
        assertEquals(1, r.report().invalid().size());
        assertTrue(r.report().invalid().get(0).contains("teleport"));
    }

    @Test
    @DisplayName("S9 KMP keyword filter: requireKeyword keeps only candidates whose instructions contain the phrase")
    void keywordFilter() {
        SubstitutionResult r = real.engine().substitute(
                new SubstitutionRequest("Barbell Back Squat", "lower-back-strain", 20, "knee-friendly", true, false));
        // "knee-friendly" is a tag, not text; use a phrase from instruction text instead
        assertEquals(SubstitutionResult.Status.NO_SAFE_SUBSTITUTE, r.status());
        SubstitutionResult r2 = real.engine().substitute(
                new SubstitutionRequest("Barbell Back Squat", "lower-back-strain", 20, "stress on the knee", true, false));
        assertEquals(SubstitutionResult.Status.OK, r2.status());
        for (SubstitutionResult.Candidate c : r2.results()) {
            assertFalse(c.keywordMatchPositions().isEmpty());
            assertTrue(c.keywordSnippet().toLowerCase().contains("[stress on the knee]"));
        }
        assertTrue(r2.pipeline().kmpComparisons() > 0);
    }

    @Test
    @DisplayName("S10 contraindication rule set: exact rule engine verdicts for known pairs")
    void ruleEngineVerdicts() {
        RuleEngine engine = new RuleEngine(List.of(new InjuryRule("x", "X", "Test", "", "", "",
                List.of(new Contraindication(InjuryRule.Kind.PATTERN, "hinge", "no hinging")))));
        Exercise hinge = new Exercise(0, "E1", "RDL", List.of("hamstrings"), List.of(), List.of("barbell"),
                "hinge", List.of(), "text");
        Exercise squat = new Exercise(1, "E2", "Squat", List.of("quads"), List.of(), List.of("barbell"),
                "squat", List.of(), "text");
        assertEquals(1, engine.evaluate(hinge, "x").size());
        assertTrue(engine.evaluate(squat, "x").isEmpty());
    }
}
