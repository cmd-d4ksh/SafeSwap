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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Groups the catalog into physical gym "stations" for the 3D gym UI. A station's exercises are
 * found with exact lookups in the tag trie (one per equipment key), so the frontend never
 * filters the catalog itself.
 */
@Service
public class GymService {

    public record Station(String id, String name, String description, List<String> equipment) { }

    public record StationSummary(String id, String name, String description, List<String> equipment,
                                 int exerciseCount) { }

    public record StationExercise(String id, String name, List<String> primaryMuscles, String movementPattern,
                                  List<String> equipment) { }

    public record StationExercises(StationSummary station, String method, int trieLookups,
                                   List<StationExercise> exercises) { }

    private final CatalogService catalogService;
    private final ResourceLoader resourceLoader;
    private final ObjectMapper mapper;
    private final String layoutPath;
    private List<Station> stations = List.of();

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

    public List<StationSummary> stations() {
        CatalogIndex catalog = catalogService.snapshot().catalog();
        if (catalog.isEmpty()) throw ApiException.catalogEmpty();
        List<StationSummary> out = new ArrayList<>();
        for (Station s : stations) out.add(summary(s, lookup(catalog, s).size()));
        return out;
    }

    public StationExercises exercises(String stationId) {
        CatalogIndex catalog = catalogService.snapshot().catalog();
        if (catalog.isEmpty()) throw ApiException.catalogEmpty();
        Station s = find(stationId);
        List<Exercise> list = lookup(catalog, s);
        List<StationExercise> out = new ArrayList<>();
        for (Exercise ex : list) {
            out.add(new StationExercise(ex.id(), ex.name(), ex.primaryMuscles(), ex.movementPattern(), ex.equipment()));
        }
        return new StationExercises(summary(s, out.size()),
                "Tag-trie exact lookup for each equipment key (" + String.join(", ", s.equipment()) + ")",
                s.equipment().size(), out);
    }

    private Station find(String id) {
        for (Station s : stations) if (s.id().equalsIgnoreCase(id)) return s;
        List<String> ids = new ArrayList<>();
        for (Station s : stations) ids.add(s.id());
        throw ApiException.notFound("STATION_NOT_FOUND", "No gym station '" + id + "'.", ids);
    }

    private static List<Exercise> lookup(CatalogIndex catalog, Station s) {
        Trie tags = catalog.tagTrie();
        Set<Integer> ids = new LinkedHashSet<>();
        for (String eq : s.equipment()) ids.addAll(tags.getExact(eq));
        List<Exercise> out = new ArrayList<>();
        for (Integer i : ids) {
            Exercise ex = catalog.get(i);
            // tag trie also stores tags/muscles; keep only true equipment matches
            for (String eq : s.equipment()) {
                if (ex.equipment().contains(eq)) { out.add(ex); break; }
            }
        }
        out.sort(Comparator.comparing(Exercise::name));
        return out;
    }

    private static StationSummary summary(Station s, int count) {
        return new StationSummary(s.id(), s.name(), s.description(), s.equipment(), count);
    }
}
