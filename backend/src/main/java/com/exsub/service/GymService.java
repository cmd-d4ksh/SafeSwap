package com.exsub.service;

import com.exsub.algo.Trie;
import com.exsub.engine.CatalogIndex;
import com.exsub.error.ApiException;
import com.exsub.model.Exercise;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Places every catalog exercise at one physical gym "station" for the 3D gym UI.
 *
 * <p>Stations are tried in file order; an exercise goes to the FIRST station whose equipment
 * list shares an item with the exercise and — if the station names keywords — whose name
 * contains one of those keywords at a word boundary. Both checks use the tries built by
 * {@link CatalogIndex}: equipment via exact tag-trie lookups, keywords via prefix searches on
 * the word-suffix name trie (e.g. keyword "row" matches "Seated Cable Row"). Stations therefore
 * partition the catalog, and the frontend never filters exercises itself.
 */
@Service
public class GymService {

    public record Station(String id, String zone, String name, String description, List<String> equipment,
                          List<String> nameKeywords) { }

    public record StationSummary(String id, String zone, String name, String description, List<String> equipment,
                                 int exerciseCount) { }

    public record StationExercise(String id, String name, List<String> primaryMuscles, String movementPattern,
                                  List<String> equipment) { }

    public record StationExercises(StationSummary station, String method, List<StationExercise> exercises) { }

    public record Location(String stationId, String stationName, String zone) { }

    private static final String METHOD = "Tag-trie exact lookup on equipment keys + name-trie word-prefix lookup on station keywords";

    private final CatalogService catalogService;
    private final ResourceLoader resourceLoader;
    private final ObjectMapper mapper;
    private final String layoutPath;

    private List<Station> stations = List.of();
    private CatalogIndex indexedCatalog;               // catalog the assignment below was computed for
    private Map<String, List<Exercise>> byStation = Map.of();
    private Map<String, Station> stationOfExercise = Map.of();
    private int unplaced;

    public GymService(CatalogService catalogService, ResourceLoader resourceLoader, ObjectMapper mapper,
                      @Value("${exsub.data.gym-layout-path:classpath:data/gym_layout.json}") String layoutPath) {
        this.catalogService = catalogService;
        this.resourceLoader = resourceLoader;
        this.mapper = mapper;
        this.layoutPath = layoutPath;
    }

    @PostConstruct
    void load() throws Exception {
        try (InputStream in = resourceLoader.getResource(layoutPath).getInputStream()) {
            stations = mapper.readValue(in, new TypeReference<List<Station>>() { });
        }
    }

    /** Computes (once per catalog snapshot) the exercise → station assignment. */
    private synchronized CatalogIndex assigned() {
        CatalogIndex catalog = catalogService.snapshot().catalog();
        if (catalog.isEmpty()) throw ApiException.catalogEmpty();
        if (catalog == indexedCatalog) return catalog;

        Map<String, Set<Integer>> keywordHits = new HashMap<>();
        for (Station s : stations) {
            if (s.nameKeywords() == null || s.nameKeywords().isEmpty()) continue;
            Set<Integer> hits = new HashSet<>();
            for (String kw : s.nameKeywords()) {
                hits.addAll(catalog.nameTrie().searchPrefix(kw, Integer.MAX_VALUE).distinctIds(Integer.MAX_VALUE));
            }
            keywordHits.put(s.id(), hits);
        }
        Map<String, Set<Integer>> equipmentHits = new HashMap<>();
        Trie tags = catalog.tagTrie();
        for (Station s : stations) {
            Set<Integer> hits = new HashSet<>();
            for (String eq : s.equipment()) {
                for (Integer i : tags.getExact(eq)) {
                    if (catalog.get(i).equipment().contains(eq)) hits.add(i); // tag trie also holds tags/muscles
                }
            }
            equipmentHits.put(s.id(), hits);
        }

        Map<String, List<Exercise>> lists = new LinkedHashMap<>();
        Map<String, Station> where = new HashMap<>();
        for (Station s : stations) lists.put(s.id(), new ArrayList<>());
        int missing = 0;
        for (Exercise ex : catalog.all()) {
            Station home = null;
            for (Station s : stations) {
                if (!equipmentHits.get(s.id()).contains(ex.index())) continue;
                Set<Integer> kw = keywordHits.get(s.id());
                if (kw != null && !kw.contains(ex.index())) continue;
                home = s;
                break;
            }
            if (home == null) { missing++; continue; }
            lists.get(home.id()).add(ex);
            where.put(ex.id().toLowerCase(), home);
        }
        for (List<Exercise> l : lists.values()) l.sort(Comparator.comparing(Exercise::name));
        byStation = lists;
        stationOfExercise = where;
        unplaced = missing;
        indexedCatalog = catalog;
        return catalog;
    }

    public List<StationSummary> stations() {
        assigned();
        List<StationSummary> out = new ArrayList<>();
        for (Station s : stations) out.add(summary(s));
        return out;
    }

    public StationExercises exercises(String stationId) {
        assigned();
        Station s = find(stationId);
        List<StationExercise> out = new ArrayList<>();
        for (Exercise ex : byStation.get(s.id())) {
            out.add(new StationExercise(ex.id(), ex.name(), ex.primaryMuscles(), ex.movementPattern(), ex.equipment()));
        }
        return new StationExercises(summary(s), METHOD, out);
    }

    /** Where in the gym each of the given exercises is done (unknown ids are omitted). */
    public Map<String, Location> locate(List<String> exerciseIds) {
        assigned();
        Map<String, Location> out = new LinkedHashMap<>();
        if (exerciseIds == null) return out;
        for (String id : exerciseIds) {
            if (id == null) continue;
            Station s = stationOfExercise.get(id.trim().toLowerCase());
            if (s != null) out.put(id.trim(), new Location(s.id(), s.name(), s.zone()));
        }
        return out;
    }

    /** Number of catalog exercises no station claims (should be 0; reported in tests). */
    public int unplacedCount() {
        assigned();
        return unplaced;
    }

    private Station find(String id) {
        for (Station s : stations) if (s.id().equalsIgnoreCase(id)) return s;
        List<String> ids = new ArrayList<>();
        for (Station s : stations) ids.add(s.id());
        throw ApiException.notFound("STATION_NOT_FOUND", "No gym station '" + id + "'.", ids);
    }

    private StationSummary summary(Station s) {
        return new StationSummary(s.id(), s.zone(), s.name(), s.description(), s.equipment(),
                byStation.getOrDefault(s.id(), List.of()).size());
    }
}
