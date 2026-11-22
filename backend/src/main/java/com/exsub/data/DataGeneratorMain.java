package com.exsub.data;

import com.exsub.data.CatalogLoader.RawExercise;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Regenerates the sample catalog.
 * <pre>
 *   cd backend
 *   mvn -q compile exec:java -Dexec.mainClass=com.exsub.data.DataGeneratorMain
 *   # optional args: [outputPath] [scaledSize]
 * </pre>
 * Two duplicate rows are injected on purpose so the loader's duplicate detection is visible
 * in GET /api/catalog/stats.
 */
public final class DataGeneratorMain {

    public static void main(String[] args) throws Exception {
        String path = args.length > 0 ? args[0] : "src/main/resources/data/exercises.json";
        List<RawExercise> rows = args.length > 1
                ? ExerciseCatalogGenerator.scaled(Integer.parseInt(args[1]), 42L)
                : new ArrayList<>(ExerciseCatalogGenerator.realistic());
        if (args.length <= 1) {
            // intentional duplicates for data-validation evidence
            RawExercise a = rows.get(0);
            rows.add(new RawExercise("EX9001", a.name().toUpperCase(), a.primaryMuscles(), a.secondaryMuscles(),
                    a.equipment(), a.movementPattern(), a.tags(), a.instructions()));
            RawExercise b = rows.get(5);
            rows.add(new RawExercise("EX9002", "  " + b.name() + "  ", b.primaryMuscles(), b.secondaryMuscles(),
                    b.equipment(), b.movementPattern(), b.tags(), b.instructions()));
        }
        File out = new File(path);
        if (out.getParentFile() != null) out.getParentFile().mkdirs();
        new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT).writeValue(out, rows);
        System.out.println("Wrote " + rows.size() + " rows to " + out.getAbsolutePath());
    }
}
