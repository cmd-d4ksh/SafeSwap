package com.exsub.service;

import com.exsub.data.CatalogLoader;
import com.exsub.data.CatalogLoader.LoadReport;
import com.exsub.data.CatalogLoader.RawExercise;
import com.exsub.engine.CatalogIndex;
import com.exsub.engine.ContraindicationIndex;
import com.exsub.engine.RuleEngine;
import com.exsub.engine.SubstitutionEngine;
import com.exsub.model.InjuryRule;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Loads the catalog + rules from files at startup and builds all indexes once
 * (tries, muscle index, contraindication Bloom filter). Holds an immutable snapshot.
 */
@Service
public class CatalogService {

    private static final Logger log = LoggerFactory.getLogger(CatalogService.class);

    /** Everything derived from one load of the data files. */
    public record Snapshot(CatalogIndex catalog, RuleEngine rules, ContraindicationIndex contraindications,
                           SubstitutionEngine engine, LoadReport report, double measuredFpp,
                           long buildMillis, String loadError) { }

    private final ResourceLoader resourceLoader;
    private final ObjectMapper mapper;
    private final String exercisesPath;
    private final String rulesPath;
    private final double bloomFpp;
    private volatile Snapshot snapshot;

    public CatalogService(ResourceLoader resourceLoader, ObjectMapper mapper,
                          @Value("${exsub.data.exercises-path}") String exercisesPath,
                          @Value("${exsub.data.rules-path}") String rulesPath,
                          @Value("${exsub.bloom.fpp:0.01}") double bloomFpp) {
        this.resourceLoader = resourceLoader;
        this.mapper = mapper;
        this.exercisesPath = exercisesPath;
        this.rulesPath = rulesPath;
        this.bloomFpp = bloomFpp;
    }

    @PostConstruct
    public void load() {
        long t0 = System.currentTimeMillis();
        String error = null;
        List<RawExercise> rows = new ArrayList<>();
        List<InjuryRule> ruleList = new ArrayList<>();
        try {
            rows = read(exercisesPath, new TypeReference<List<RawExercise>>() { });
        } catch (Exception e) {
            error = "Could not read exercise catalog '" + exercisesPath + "': " + e.getMessage();
            log.error(error);
        }
        try {
            ruleList = read(rulesPath, new TypeReference<List<InjuryRule>>() { });
        } catch (Exception e) {
            error = (error == null ? "" : error + " | ") + "Could not read rules '" + rulesPath + "': " + e.getMessage();
            log.error(error);
        }
        snapshot = build(rows == null ? List.of() : rows, ruleList == null ? List.of() : ruleList, bloomFpp, error,
                System.currentTimeMillis() - t0);
        LoadReport r = snapshot.report();
        log.info("Catalog loaded: {} rows read, {} accepted, {} duplicates, {} invalid; {} contraindicated pairs; "
                        + "Bloom m={} k={} measured FPP={}",
                r.rowsRead(), r.accepted(), r.duplicates().size(), r.invalid().size(),
                snapshot.contraindications().pairCount(), snapshot.contraindications().bloom().bitSize(),
                snapshot.contraindications().bloom().hashCount(), snapshot.measuredFpp());
    }

    /** Pure builder, also used by tests. */
    public static Snapshot build(List<RawExercise> rows, List<InjuryRule> rules, double fpp, String error, long readMillis) {
        long t0 = System.currentTimeMillis();
        CatalogLoader.Result loaded = CatalogLoader.load(rows);
        CatalogIndex catalog = new CatalogIndex(loaded.exercises());
        RuleEngine engine = new RuleEngine(rules);
        ContraindicationIndex ci = ContraindicationIndex.build(loaded.exercises(), engine, fpp);
        List<String> tags = new ArrayList<>();
        for (InjuryRule r : rules) tags.add(r.tag());
        double fppMeasured = ci.measuredFalsePositiveRate(loaded.exercises(), tags);
        return new Snapshot(catalog, engine, ci, new SubstitutionEngine(catalog, engine, ci), loaded.report(),
                fppMeasured, readMillis + System.currentTimeMillis() - t0, error);
    }

    private <T> T read(String path, TypeReference<T> type) throws Exception {
        Resource res = resourceLoader.getResource(path);
        try (InputStream in = res.getInputStream()) {
            return mapper.readValue(in, type);
        }
    }

    public Snapshot snapshot() { return snapshot; }

    private volatile String source = "sample data (src/main/resources/data/exercises.json)";

    public String source() { return source; }

    /**
     * Replaces the active catalog with user-uploaded rows (same validation as the sample file:
     * duplicates and invalid rows are rejected and reported). The injury rules are kept. Every
     * index (tries, Bloom filter, gym stations) is rebuilt from the new snapshot. An upload in
     * which no row survives validation is refused and the current catalog stays active.
     */
    public synchronized Snapshot replaceCatalog(List<RawExercise> rows, String label) {
        if (rows == null) {
            throw com.exsub.error.ApiException.badRequest("CATALOG_BODY_REQUIRED", "Send a JSON array of exercises.", List.of());
        }
        if (rows.size() > 100_000) {
            throw com.exsub.error.ApiException.badRequest("CATALOG_TOO_LARGE", "At most 100,000 rows per upload.", List.of());
        }
        long t0 = System.currentTimeMillis();
        Snapshot next = build(rows, new ArrayList<>(snapshot.rules().rules()), bloomFpp, null, 0);
        if (next.catalog().isEmpty()) {
            List<String> why = new ArrayList<>(next.report().invalid());
            why.addAll(next.report().duplicates());
            throw com.exsub.error.ApiException.badRequest("CATALOG_UPLOAD_EMPTY",
                    rows.isEmpty() ? "The uploaded dataset is empty; the current catalog was kept."
                            : "No row passed validation; the current catalog was kept.",
                    why.size() > 20 ? why.subList(0, 20) : why);
        }
        snapshot = next;
        source = label == null || label.isBlank() ? "uploaded dataset" : label;
        log.info("Catalog replaced by upload '{}': {} accepted in {} ms", source, next.catalog().size(), System.currentTimeMillis() - t0);
        return next;
    }

    /** Restores the shipped sample data. */
    public synchronized void reset() {
        load();
        source = "sample data (src/main/resources/data/exercises.json)";
    }
}
