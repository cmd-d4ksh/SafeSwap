package com.exsub.controller;

import com.exsub.algo.BloomFilter;
import com.exsub.engine.SubstitutionRequest;
import com.exsub.engine.SubstitutionResult;
import com.exsub.error.ApiException;
import com.exsub.model.Exercise;
import com.exsub.service.CatalogService;
import com.exsub.service.FormGuideService;
import com.exsub.service.GymService;
import com.exsub.service.PlanService;
import com.exsub.service.SearchService;
import com.exsub.service.SubstitutionService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** REST layer: request parsing and response shaping only; no algorithm logic here. */
@RestController
@RequestMapping("/api")
public class ApiController {

    private final CatalogService catalogService;
    private final SearchService searchService;
    private final SubstitutionService substitutionService;
    private final GymService gymService;
    private final FormGuideService formGuideService;
    private final PlanService planService;

    public ApiController(CatalogService catalogService, SearchService searchService,
                         SubstitutionService substitutionService, GymService gymService,
                         FormGuideService formGuideService, PlanService planService) {
        this.catalogService = catalogService;
        this.searchService = searchService;
        this.substitutionService = substitutionService;
        this.gymService = gymService;
        this.formGuideService = formGuideService;
        this.planService = planService;
    }

    @GetMapping("/gym/stations")
    public List<GymService.StationSummary> stations() {
        return gymService.stations();
    }

    @GetMapping("/gym/stations/{id}/exercises")
    public GymService.StationExercises stationExercises(@PathVariable String id) {
        return gymService.exercises(id);
    }

    /** Where each exercise is done, e.g. /api/gym/locate?ids=EX0001,EX0187 */
    @GetMapping("/gym/locate")
    public Map<String, GymService.Location> locate(@RequestParam(required = false) List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            throw ApiException.badRequest("IDS_REQUIRED", "Query parameter 'ids' (comma-separated exercise ids) is required.", List.of());
        }
        return gymService.locate(ids);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        CatalogService.Snapshot s = catalogService.snapshot();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", s.catalog().isEmpty() ? "DEGRADED" : "UP");
        m.put("exercises", s.catalog().size());
        m.put("injuryTags", s.rules().rules().size());
        if (s.loadError() != null) m.put("loadError", s.loadError());
        return m;
    }

    @GetMapping("/injuries")
    public List<SubstitutionService.InjuryInfo> injuries() {
        return substitutionService.injuries();
    }

    @GetMapping("/exercises/autocomplete")
    public SearchService.AutocompleteResponse autocomplete(@RequestParam(required = false) String prefix,
                                                           @RequestParam(defaultValue = "name") String mode,
                                                           @RequestParam(defaultValue = "10") int limit) {
        return searchService.autocomplete(prefix, mode, limit);
    }

    @GetMapping("/exercises/text-search")
    public SearchService.TextSearchResponse textSearch(@RequestParam(required = false) String q,
                                                       @RequestParam(defaultValue = "20") int limit) {
        return searchService.textSearch(q, limit);
    }

    /** Step-by-step form guide plus the demo motion the 3D coach should play. */
    @GetMapping("/exercises/{id}/guide")
    public FormGuideService.Guide guide(@PathVariable String id) {
        return formGuideService.guide(id);
    }

    @GetMapping("/exercises/{id}")
    public Exercise byId(@PathVariable String id) {
        Exercise ex = catalogService.snapshot().catalog().byId(id);
        if (ex == null) throw ApiException.notFound("EXERCISE_NOT_FOUND", "No exercise with id '" + id + "'.", List.of());
        return ex;
    }

    /** Safe beginner weekly plan for an injury (or "none"); every exercise passes Bloom + rule confirmation. */
    @PostMapping("/plans")
    public PlanService.Plan plan(@RequestBody(required = false) PlanService.PlanRequest request) {
        return planService.build(request);
    }

    @PostMapping("/substitutions")
    public SubstitutionResult substitute(@RequestBody(required = false) SubstitutionRequest request) {
        if (request == null) {
            throw ApiException.badRequest("BODY_REQUIRED", "A JSON body with 'exercise' and 'injuryTag' is required.", List.of());
        }
        return substitutionService.substitute(request);
    }

    @GetMapping("/catalog/stats")
    public Map<String, Object> stats() {
        CatalogService.Snapshot s = catalogService.snapshot();
        BloomFilter bf = s.contraindications().bloom();
        Map<String, Object> bloom = new LinkedHashMap<>();
        bloom.put("bits_m", bf.bitSize());
        bloom.put("hashFunctions_k", bf.hashCount());
        bloom.put("insertedPairs_n", bf.insertedCount());
        bloom.put("targetFpp", bf.targetFpp());
        bloom.put("theoreticalFpp", bf.expectedFpp());
        bloom.put("measuredFpp", s.measuredFpp());
        bloom.put("fillRatio", bf.fillRatio());
        bloom.put("memoryBytes", bf.memoryBytes());

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("exercises", s.catalog().size());
        m.put("loadReport", s.report());
        m.put("nameTrie", Map.of("keys", s.catalog().nameTrie().keyCount(), "nodes", s.catalog().nameTrie().nodeCount()));
        m.put("tagTrie", Map.of("keys", s.catalog().tagTrie().keyCount(), "nodes", s.catalog().tagTrie().nodeCount()));
        m.put("contraindicatedPairs", s.contraindications().pairCount());
        m.put("contraindicatedPerInjury", s.contraindications().pairsPerInjury());
        m.put("bloomFilter", bloom);
        m.put("buildMillis", s.buildMillis());
        if (s.loadError() != null) m.put("loadError", s.loadError());
        return m;
    }
}
