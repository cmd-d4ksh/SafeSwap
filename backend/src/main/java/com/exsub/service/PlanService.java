package com.exsub.service;

import com.exsub.engine.CatalogIndex;
import com.exsub.engine.ContraindicationIndex;
import com.exsub.engine.RuleEngine;
import com.exsub.error.ApiException;
import com.exsub.model.Exercise;
import com.exsub.model.InjuryRule;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Builds a beginner weekly plan that is safe for the user's pain/injury.
 *
 * <p>The week is split by day count (2 = upper/lower, 3 = push/pull/legs, 4 = push/pull/legs/arms+core).
 * Each day lists muscle "slots". For every slot, catalog exercises whose first primary muscle matches
 * are screened with the same safety pipeline as substitutions: a Bloom-filter pre-check, and every
 * "possibly unsafe" answer confirmed by the exact rule engine. Nothing is rejected on the Bloom answer
 * alone. Safe candidates are then ranked for beginners (guided machines and cables first, "friendly"
 * tags up, explosive or advanced variants down) and the best unused one fills the slot.
 */
@Service
public class PlanService {

    public record PlanRequest(String injuryTag, Integer daysPerWeek) { }

    public record PlanItem(String id, String name, List<String> primaryMuscles, String role, String dose,
                           String motionLabel, String stationId, String stationName, String zone,
                           String safetyMethod, String why) { }

    public record PlanDay(int day, String title, String focus, List<PlanItem> items) { }

    public record Avoid(String id, String name, String reason) { }

    public record Stats(int candidatesScreened, int bloomNegatives, int bloomPositives, int confirmedUnsafe,
                        int falsePositivesCleared, long elapsedMicros) { }

    public record Plan(String injuryTag, String injuryName, String area, String guidance, int daysPerWeek,
                       List<String> split, List<String> schedule, List<String> tips, List<PlanDay> days,
                       List<Avoid> avoid, Stats stats, String method) { }

    private record DayTemplate(String title, String focus, List<String> slots) { }

    private static final Map<Integer, List<DayTemplate>> SPLITS = Map.of(
        2, List.of(
            new DayTemplate("Upper body", "Chest, back, shoulders and arms",
                    List.of("chest", "lats", "front-delts", "rhomboids", "biceps", "triceps")),
            new DayTemplate("Lower body & core", "Legs, glutes and core",
                    List.of("quads", "hamstrings", "glutes", "calves", "core"))),
        3, List.of(
            new DayTemplate("Push", "Chest, shoulders and triceps",
                    List.of("chest", "front-delts", "side-delts", "triceps", "core")),
            new DayTemplate("Pull", "Back and biceps",
                    List.of("lats", "rhomboids", "rear-delts", "biceps", "obliques")),
            new DayTemplate("Legs", "Quads, hamstrings, glutes and calves",
                    List.of("quads", "hamstrings", "glutes", "calves", "core"))),
        4, List.of(
            new DayTemplate("Push", "Chest, shoulders and triceps",
                    List.of("chest", "front-delts", "side-delts", "triceps")),
            new DayTemplate("Pull", "Back and rear shoulders",
                    List.of("lats", "rhomboids", "rear-delts", "traps")),
            new DayTemplate("Legs", "Quads, hamstrings, glutes and calves",
                    List.of("quads", "hamstrings", "glutes", "calves")),
            new DayTemplate("Arms & core", "Biceps, triceps, forearms and core",
                    List.of("biceps", "triceps", "forearms", "core", "obliques")))
    );

    private static final Map<Integer, List<String>> SCHEDULES = Map.of(
        2, List.of("Mon", "Thu"), 3, List.of("Mon", "Wed", "Fri"), 4, List.of("Mon", "Tue", "Thu", "Fri"));

    private static final List<String> WARMUPS = List.of("Stationary Bike Sprint", "Elliptical Trainer", "Treadmill Walk", "Rowing Machine");
    private static final Set<String> FRIENDLY = Set.of("knee-friendly", "shoulder-friendly", "low-load", "spine-neutral",
            "low-spinal-load", "supported", "low-impact", "neutral-wrist", "neutral-grip");
    private static final Set<String> ADVANCED = Set.of("explosive", "plyometric", "high-impact", "hanging",
            "axial-loading", "spinal-load-heavy", "eccentric-high", "eccentric-hamstring-high", "single-leg-balance");

    private final CatalogService catalogService;
    private final GymService gymService;
    private final FormGuideService formGuideService;

    public PlanService(CatalogService catalogService, GymService gymService, FormGuideService formGuideService) {
        this.catalogService = catalogService;
        this.gymService = gymService;
        this.formGuideService = formGuideService;
    }

    public Plan build(PlanRequest req) {
        long t0 = System.nanoTime();
        CatalogService.Snapshot snap = catalogService.snapshot();
        CatalogIndex catalog = snap.catalog();
        if (catalog.isEmpty()) throw ApiException.catalogEmpty();
        RuleEngine rules = snap.rules();
        ContraindicationIndex contra = snap.contraindications();

        String tag = req == null || req.injuryTag() == null || req.injuryTag().isBlank() || req.injuryTag().equals("none")
                ? null : req.injuryTag().trim();
        if (tag != null && !rules.isKnownInjury(tag)) {
            List<String> valid = new ArrayList<>();
            rules.rules().forEach(r -> valid.add(r.tag()));
            throw ApiException.badRequest("UNKNOWN_INJURY_TAG", "Unknown injury tag '" + tag + "'.", valid);
        }
        int days = req == null || req.daysPerWeek() == null ? 3 : req.daysPerWeek();
        if (days < 2 || days > 4) {
            throw ApiException.badRequest("DAYS_OUT_OF_RANGE", "daysPerWeek must be 2, 3 or 4.", List.of("2", "3", "4"));
        }

        // --- safety screen: Bloom pre-check, every positive confirmed by the exact rule engine ---
        Map<String, String> safetyMethod = new LinkedHashMap<>();
        Map<String, String> unsafeReason = new LinkedHashMap<>();
        int negatives = 0, positives = 0, confirmed = 0, cleared = 0;
        for (Exercise ex : catalog.all()) {
            if (tag == null) { safetyMethod.put(ex.id(), "NO_INJURY"); continue; }
            if (!contra.possiblyContraindicated(ex.id(), tag)) {
                negatives++;
                safetyMethod.put(ex.id(), "BLOOM_NEGATIVE");
                continue;
            }
            positives++;
            List<String> why = rules.evaluate(ex, tag);
            if (why.isEmpty()) { cleared++; safetyMethod.put(ex.id(), "BLOOM_POSITIVE_RULE_CLEARED"); }
            else { confirmed++; unsafeReason.put(ex.id(), why.get(0).replaceFirst("^[a-z]+ '[^']+': ", "")); }
        }

        Set<String> used = new HashSet<>();
        List<PlanDay> out = new ArrayList<>();
        List<DayTemplate> split = SPLITS.get(days);
        for (int d = 0; d < split.size(); d++) {
            DayTemplate dt = split.get(d);
            List<PlanItem> items = new ArrayList<>();
            Exercise warm = pickWarmup(catalog, safetyMethod, d);
            if (warm != null) items.add(item(warm, "Warm-up", "5–8 min easy pace", safetyMethod.get(warm.id()), "Gets blood flowing; easy on the joints."));
            Set<String> usedToday = new HashSet<>();
            for (String muscle : dt.slots()) {
                Exercise best = null;
                int bestScore = Integer.MIN_VALUE;
                for (Exercise ex : catalog.all()) {
                    if (!safetyMethod.containsKey(ex.id()) || used.contains(ex.id())) continue;
                    if (ex.primaryMuscles().isEmpty() || !ex.primaryMuscles().get(0).equals(muscle)) continue;
                    if (ex.equipment().stream().anyMatch(e -> e.matches("treadmill|stationary-bike|air-bike|rowing-machine|elliptical|stair-climber"))) continue;
                    String base = baseName(ex.name());
                    if (usedToday.contains(base)) continue;
                    int s = beginnerScore(ex);
                    if (s > bestScore || (s == bestScore && ex.name().compareTo(best.name()) < 0)) { best = ex; bestScore = s; }
                }
                if (best == null) continue; // no safe option for this muscle: the slot is skipped
                used.add(best.id());
                usedToday.add(baseName(best.name()));
                items.add(item(best, "Main", null, safetyMethod.get(best.id()), why(best)));
            }
            out.add(new PlanDay(d + 1, dt.title(), dt.focus(), items));
        }

        List<Avoid> avoid = new ArrayList<>();
        unsafeReason.entrySet().stream()
                .map(e -> catalog.byId(e.getKey()))
                .filter(ex -> !ex.name().startsWith("Tempo ") && !ex.name().startsWith("Paused ") && !ex.name().startsWith("Single-Arm"))
                .sorted(Comparator.comparingInt((Exercise ex) -> -beginnerScore(ex)).thenComparing(Exercise::name))
                .limit(8)
                .forEach(ex -> avoid.add(new Avoid(ex.id(), ex.name(), unsafeReason.get(ex.id()))));

        InjuryRule rule = tag == null ? null : rules.rule(tag);
        List<String> tips = new ArrayList<>(List.of(
                "Rest at least one day between sessions.",
                "Pick a weight you could lift 2–3 more times at the end of each set.",
                "When every set feels easy for two sessions in a row, add a little weight or 1–2 reps.",
                "Pain above 3 out of 10, or pain that is sharp or lasts into the next day, means stop and swap."));
        if (rule != null) tips.add(0, rule.guidance());

        long micros = (System.nanoTime() - t0) / 1000;
        return new Plan(tag, rule == null ? "No pain reported" : rule.name(), rule == null ? null : rule.area(),
                rule == null ? null : rule.guidance(), days, split.stream().map(DayTemplate::title).toList(),
                SCHEDULES.get(days), tips, out, avoid,
                new Stats(catalog.size(), negatives, positives, confirmed, cleared, micros),
                "Bloom-filter pre-check on every (exercise, injury) pair; every 'possibly unsafe' confirmed by the exact rule engine; "
                        + "beginner ranking per muscle slot; stations via tries; demo motion via KMP");
    }

    private Exercise pickWarmup(CatalogIndex catalog, Map<String, String> safe, int day) {
        for (int i = 0; i < WARMUPS.size(); i++) {
            Exercise ex = catalog.byExactName(WARMUPS.get((day + i) % WARMUPS.size()));
            if (ex != null && safe.containsKey(ex.id())) return ex;
        }
        return null;
    }

    private PlanItem item(Exercise ex, String role, String dose, String method, String why) {
        FormGuideService.Guide g = formGuideService.guide(ex.id());
        GymService.Location loc = gymService.locate(List.of(ex.id())).get(ex.id());
        return new PlanItem(ex.id(), ex.name(), ex.primaryMuscles(), role, dose != null ? dose : g.beginnerDose(), g.motionLabel(),
                loc == null ? null : loc.stationId(), loc == null ? null : loc.stationName(), loc == null ? null : loc.zone(),
                method, why);
    }

    /** Higher = better first choice for a beginner. */
    static int beginnerScore(Exercise ex) {
        int s = 0;
        String eq = ex.equipment().isEmpty() ? "" : ex.equipment().get(0);
        s += switch (eq) {
            case "machine" -> 6; case "cable" -> 5; case "dumbbell" -> 4; case "smith-machine", "assisted-machine" -> 3;
            case "bodyweight", "resistance-band", "kettlebell" -> 2; case "barbell", "ez-bar" -> 1; default -> 0;
        };
        for (String t : ex.tags()) {
            if (FRIENDLY.contains(t)) s += 2;
            if (ADVANCED.contains(t)) s -= 3;
        }
        String n = ex.name();
        if (n.startsWith("Tempo ") || n.startsWith("Paused ")) s -= 4;
        if (n.startsWith("Single-Arm")) s -= 2;
        return s;
    }

    private static String why(Exercise ex) {
        String eq = ex.equipment().isEmpty() ? "" : ex.equipment().get(0);
        String base = switch (eq) {
            case "machine" -> "A guided machine: the path is fixed, so it is easy to learn.";
            case "cable" -> "Cables give smooth, steady resistance and are easy to adjust.";
            case "dumbbell" -> "Dumbbells let each side move naturally.";
            case "bodyweight" -> "No equipment needed; scale it by range of motion.";
            default -> "A solid basic for this muscle.";
        };
        for (String t : ex.tags()) {
            if (t.equals("supported")) return base + " The pad supports your body.";
            if (t.endsWith("-friendly")) return base + " Kind to the " + t.replace("-friendly", "") + ".";
        }
        return base;
    }

    /** "Dumbbell Hammer Curl" and "Cable Hammer Curl" share the base "hammer curl" (avoid repeats in one day). */
    private static String baseName(String name) {
        String n = name.toLowerCase().replaceFirst("^(tempo |paused |single-arm cable |single-arm )", "");
        String[] labels = {"barbell ", "dumbbell ", "machine ", "cable ", "kettlebell ", "smith machine ", "banded ", "ez-bar ",
                "assisted ", "landmine ", "bench ", "decline ", "plate ", "medicine ball ", "stability ball ", "suspension ", "trap bar "};
        for (String l : labels) if (n.startsWith(l)) return n.substring(l.length());
        return n;
    }
}
