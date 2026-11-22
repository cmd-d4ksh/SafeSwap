package com.exsub.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** End-to-end HTTP tests against the real sample data shipped in src/main/resources/data. */
@SpringBootTest
@AutoConfigureMockMvc
class ApiIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Test
    void statsReportDuplicatesAndBloomSizing() throws Exception {
        mvc.perform(get("/api/catalog/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exercises", greaterThanOrEqualTo(150)))
                .andExpect(jsonPath("$.loadReport.duplicates", hasSize(2)))
                .andExpect(jsonPath("$.bloomFilter.hashFunctions_k", is(7)));
    }

    @Test
    void autocompleteByNameAndTag() throws Exception {
        mvc.perform(get("/api/exercises/autocomplete").param("prefix", "bench").param("mode", "name"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exercises[0].name", containsStringIgnoringCase("bench")));
        mvc.perform(get("/api/exercises/autocomplete").param("prefix", "over").param("mode", "tag"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tags[0].tag", is("overhead")));
    }

    @Test
    void validationErrors() throws Exception {
        mvc.perform(get("/api/exercises/autocomplete").param("prefix", ""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("PREFIX_REQUIRED")));
        mvc.perform(post("/api/substitutions").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"exercise\":\"Barbell Back Squat\",\"injuryTag\":\"broken-leg\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("UNKNOWN_INJURY_TAG")))
                .andExpect(jsonPath("$.hints", hasItem("lower-back-strain")));
        mvc.perform(post("/api/substitutions").contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("MALFORMED_JSON")));
    }

    @Test
    void substitutionHappyPath() throws Exception {
        mvc.perform(post("/api/substitutions").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"exercise\":\"Barbell Overhead Press\",\"injuryTag\":\"shoulder-impingement\",\"maxResults\":5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("OK")))
                .andExpect(jsonPath("$.results", hasSize(lessThanOrEqualTo(5))))
                .andExpect(jsonPath("$.results[0].safetyMethod", anyOf(is("BLOOM_NEGATIVE"), is("BLOOM_POSITIVE_RULE_CLEARED"))))
                .andExpect(jsonPath("$.pipeline.safetyCheck", containsString("Bloom")));
    }

    @Autowired
    GymService gymService;

    @Autowired
    CatalogService catalogService;

    @Test
    void gymStationsPartitionCatalogViaTries() throws Exception {
        mvc.perform(get("/api/gym/stations"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(35)))
                .andExpect(jsonPath("$[*].exerciseCount", everyItem(greaterThan(0))));
        // every catalog exercise is placed at exactly one station
        int total = gymService.stations().stream().mapToInt(GymService.StationSummary::exerciseCount).sum();
        org.junit.jupiter.api.Assertions.assertEquals(0, gymService.unplacedCount());
        org.junit.jupiter.api.Assertions.assertEquals(catalogService.snapshot().catalog().size(), total);

        mvc.perform(get("/api/gym/stations/cables/exercises"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.method", containsString("trie")))
                .andExpect(jsonPath("$.exercises[*].equipment[0]", everyItem(is("cable"))));
        mvc.perform(get("/api/gym/stations/treadmills/exercises"))
                .andExpect(jsonPath("$.exercises[*].name", hasItem("Treadmill Walk")));
        mvc.perform(get("/api/gym/stations/bench/exercises"))
                .andExpect(jsonPath("$.exercises[*].name", hasItem("Barbell Bench Press")))
                .andExpect(jsonPath("$.exercises[*].name", not(hasItem("Barbell Back Squat"))));
        mvc.perform(get("/api/gym/locate").param("ids", "EX0001,nope"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.EX0001.stationId", is("bench")))
                .andExpect(jsonPath("$.nope").doesNotExist());
        mvc.perform(get("/api/gym/stations/sauna/exercises"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code", is("STATION_NOT_FOUND")));
        mvc.perform(get("/api/injuries"))
                .andExpect(jsonPath("$[0].area", is("Lower back")));
    }

    @Autowired
    FormGuideService formGuideService;

    @Test
    void formGuideMapsEveryExerciseToADemoMotionViaKmp() throws Exception {
        mvc.perform(get("/api/exercises/EX0001/guide"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.motion", is("bench")))
                .andExpect(jsonPath("$.matchedBy", containsString("KMP")))
                .andExpect(jsonPath("$.steps", hasSize(greaterThanOrEqualTo(3))))
                .andExpect(jsonPath("$.cues", not(empty())))
                .andExpect(jsonPath("$.mistakes", not(empty())));
        mvc.perform(get("/api/exercises/NOPE/guide"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code", is("EXERCISE_NOT_FOUND")));

        var catalog = catalogService.snapshot().catalog();
        java.util.Map<String, String> expected = java.util.Map.of(
                "Barbell Back Squat", "squat",
                "Medicine Ball Rotational Throw", "twist",   // "throw" contains "row": rotation rules must win
                "Dumbbell Biceps Curl", "curl",
                "Machine Leg Curl", "legcurl",
                "Cable Lat Pulldown", "pulldown",
                "Treadmill Run", "run",
                "Machine Leg Press", "legpress",
                "Rowing Machine", "rowing");
        expected.forEach((name, motion) ->
                org.junit.jupiter.api.Assertions.assertEquals(motion, formGuideService.motionFor(catalog.byExactName(name))[0], name));
        for (var ex : catalog.all()) {
            var g = formGuideService.guide(ex.id());
            org.junit.jupiter.api.Assertions.assertFalse(g.steps().isEmpty(), ex.name());
        }
    }

    @Test
    void textSearchUsesKmp() throws Exception {
        mvc.perform(get("/api/exercises/text-search").param("q", "neutral spine"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matches", greaterThan(0)))
                .andExpect(jsonPath("$.method", containsString("KMP")));
    }
}
