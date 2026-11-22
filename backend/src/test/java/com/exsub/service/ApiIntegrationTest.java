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

    @Test
    void gymStationsCoverCatalogViaTagTrie() throws Exception {
        mvc.perform(get("/api/gym/stations"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(8)))
                .andExpect(jsonPath("$[0].exerciseCount", greaterThan(0)));
        mvc.perform(get("/api/gym/stations/cables/exercises"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.method", containsString("trie")))
                .andExpect(jsonPath("$.exercises[*].equipment[0]", everyItem(is("cable"))));
        mvc.perform(get("/api/gym/stations/sauna/exercises"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code", is("STATION_NOT_FOUND")));
        mvc.perform(get("/api/injuries"))
                .andExpect(jsonPath("$[0].area", is("Lower back")));
    }

    @Test
    void textSearchUsesKmp() throws Exception {
        mvc.perform(get("/api/exercises/text-search").param("q", "neutral spine"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matches", greaterThan(0)))
                .andExpect(jsonPath("$.method", containsString("KMP")));
    }
}
