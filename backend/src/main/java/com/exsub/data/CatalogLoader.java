package com.exsub.data;

import com.exsub.algo.Trie;
import com.exsub.model.Exercise;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Validates raw catalog rows and assigns dense indexes. Never silently drops data: every
 * rejected row is recorded in the {@link LoadReport} with the reason (duplicate name/id,
 * missing field, unknown movement pattern).
 */
public final class CatalogLoader {

    /** Raw JSON row (no dense index yet). */
    public record RawExercise(String id, String name, List<String> primaryMuscles, List<String> secondaryMuscles,
                              List<String> equipment, String movementPattern, List<String> tags,
                              String instructions) { }

    public record LoadReport(int rowsRead, int accepted, List<String> duplicates, List<String> invalid) { }

    public record Result(List<Exercise> exercises, LoadReport report) { }

    private CatalogLoader() { }

    public static Result load(List<RawExercise> rows) {
        List<Exercise> out = new ArrayList<>();
        List<String> duplicates = new ArrayList<>();
        List<String> invalid = new ArrayList<>();
        Set<String> seenNames = new HashSet<>();
        Set<String> seenIds = new HashSet<>();
        int read = rows == null ? 0 : rows.size();
        if (rows != null) {
            for (int i = 0; i < rows.size(); i++) {
                RawExercise r = rows.get(i);
                String problem = validate(r);
                if (problem != null) {
                    invalid.add("row " + i + ": " + problem);
                    continue;
                }
                String normName = Trie.normalize(r.name());
                String normId = r.id().trim().toLowerCase();
                if (!seenNames.add(normName)) {
                    duplicates.add("row " + i + ": duplicate name '" + r.name() + "' (" + r.id() + ") — kept first occurrence");
                    continue;
                }
                if (!seenIds.add(normId)) {
                    seenNames.remove(normName);
                    duplicates.add("row " + i + ": duplicate id '" + r.id() + "' (" + r.name() + ") — kept first occurrence");
                    continue;
                }
                out.add(new Exercise(out.size(), r.id().trim(), r.name().trim(),
                        lower(r.primaryMuscles()), lower(r.secondaryMuscles()), lower(r.equipment()),
                        r.movementPattern().trim().toLowerCase(), lower(r.tags()), r.instructions().trim()));
            }
        }
        return new Result(out, new LoadReport(read, out.size(), duplicates, invalid));
    }

    private static String validate(RawExercise r) {
        if (r == null) return "null row";
        if (r.id() == null || r.id().isBlank()) return "missing id";
        if (r.name() == null || r.name().isBlank()) return "missing name (" + r.id() + ")";
        if (r.primaryMuscles() == null || r.primaryMuscles().isEmpty()) return "no primary muscle (" + r.id() + ")";
        if (r.movementPattern() == null || !Exercise.MOVEMENT_PATTERNS.contains(r.movementPattern().trim().toLowerCase())) {
            return "invalid movement pattern '" + r.movementPattern() + "' (" + r.id() + ")";
        }
        if (r.equipment() == null || r.equipment().isEmpty()) return "no equipment listed (" + r.id() + ")";
        if (r.instructions() == null || r.instructions().isBlank()) return "missing instructions (" + r.id() + ")";
        return null;
    }

    private static List<String> lower(List<String> in) {
        List<String> out = new ArrayList<>();
        if (in != null) for (String s : in) if (s != null && !s.isBlank()) out.add(s.trim().toLowerCase());
        return out;
    }
}
