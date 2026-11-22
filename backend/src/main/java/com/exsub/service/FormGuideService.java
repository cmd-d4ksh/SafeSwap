package com.exsub.service;

import com.exsub.algo.KmpMatcher;
import com.exsub.error.ApiException;
import com.exsub.model.Exercise;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * "How to do it" guides for the 3D gym.
 *
 * <p>Each exercise is mapped to a demo motion (e.g. "squat", "row", "curl") by scanning its
 * lower-cased name with one pre-built {@link KmpMatcher} per keyword rule, in priority order;
 * the first rule that matches wins, otherwise the movement pattern's default is used. The
 * motion selects the animation the frontend plays and a family of coaching cues. The numbered
 * steps come from the exercise's own instruction text, split into sentences.
 */
@Service
public class FormGuideService {

    public record Guide(String id, String name, String motion, String motionLabel, String matchedBy,
                        List<String> primaryMuscles, List<String> secondaryMuscles, List<String> equipment,
                        List<String> steps, List<String> cues, List<String> mistakes,
                        String breathing, String tempo, String beginnerDose, String note) { }

    private record Rule(String keyword, KmpMatcher matcher, String motion) { }

    private record Family(List<String> cues, List<String> mistakes, String breathing, String tempo, String dose) { }

    private static final String NOTE = "General coaching cues for synthetic data, not medical advice. Stop if you feel sharp pain.";

    private final CatalogService catalogService;
    private final ResourceLoader resourceLoader;
    private final ObjectMapper mapper;
    private final String path;

    private final List<Rule> rules = new ArrayList<>();
    private final Map<String, String> patternDefault = new HashMap<>();
    private final Map<String, String[]> motions = new HashMap<>();   // motion -> [label, family]
    private final Map<String, Family> families = new HashMap<>();

    public FormGuideService(CatalogService catalogService, ResourceLoader resourceLoader, ObjectMapper mapper,
                            @Value("${exsub.data.form-guides-path:classpath:data/form_guides.json}") String path) {
        this.catalogService = catalogService;
        this.resourceLoader = resourceLoader;
        this.mapper = mapper;
        this.path = path;
    }

    @PostConstruct
    void load() throws Exception {
        JsonNode root;
        try (InputStream in = resourceLoader.getResource(path).getInputStream()) {
            root = mapper.readTree(in);
        }
        for (JsonNode r : root.get("rules")) {
            String kw = r.get(0).asText().toLowerCase(Locale.ROOT);
            rules.add(new Rule(kw, new KmpMatcher(kw), r.get(1).asText())); // failure function built once
        }
        root.get("patternDefault").fields().forEachRemaining(e -> patternDefault.put(e.getKey(), e.getValue().asText()));
        root.get("motions").fields().forEachRemaining(e ->
                motions.put(e.getKey(), new String[]{e.getValue().get(0).asText(), e.getValue().get(1).asText()}));
        root.get("families").fields().forEachRemaining(e -> {
            JsonNode f = e.getValue();
            families.put(e.getKey(), new Family(strings(f.get("cues")), strings(f.get("mistakes")),
                    f.get("breathing").asText(), f.get("tempo").asText(), f.get("dose").asText()));
        });
        for (Rule r : rules) {
            if (!motions.containsKey(r.motion())) throw new IllegalStateException("Unknown motion in form guide rule: " + r.motion());
        }
    }

    /** Returns [motion, matched keyword or "pattern:<p>"] for an exercise. */
    String[] motionFor(Exercise ex) {
        String name = ex.name().toLowerCase(Locale.ROOT);
        for (Rule r : rules) {
            if (r.matcher().indexIn(name) >= 0) return new String[]{r.motion(), r.keyword()};
        }
        return new String[]{patternDefault.getOrDefault(ex.movementPattern(), "curl"), "pattern:" + ex.movementPattern()};
    }

    public Guide guide(String exerciseId) {
        var catalog = catalogService.snapshot().catalog();
        if (catalog.isEmpty()) throw ApiException.catalogEmpty();
        Exercise ex = catalog.byId(exerciseId);
        if (ex == null) throw ApiException.notFound("EXERCISE_NOT_FOUND", "No exercise with id '" + exerciseId + "'.", List.of());
        String[] m = motionFor(ex);
        String[] info = motions.get(m[0]);
        Family f = families.get(info[1]);
        return new Guide(ex.id(), ex.name(), m[0], info[0],
                m[1].startsWith("pattern:") ? "Movement pattern '" + ex.movementPattern() + "' (no keyword matched)"
                        : "KMP keyword match: \"" + m[1] + "\"",
                ex.primaryMuscles(), ex.secondaryMuscles(), ex.equipment(),
                steps(ex.instructions()), f.cues(), f.mistakes(), f.breathing(), f.tempo(), f.dose(), NOTE);
    }

    /** Splits instruction text into sentences; each becomes a numbered step. */
    static List<String> steps(String text) {
        List<String> out = new ArrayList<>();
        if (text == null) return out;
        for (String s : text.trim().split("(?<=\\.)\\s+")) {
            String t = s.trim();
            if (!t.isEmpty()) out.add(t);
        }
        return out;
    }

    private static List<String> strings(JsonNode arr) {
        List<String> out = new ArrayList<>();
        if (arr != null) arr.forEach(n -> out.add(n.asText()));
        return out;
    }
}
