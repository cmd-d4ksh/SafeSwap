package com.exsub.model;

import java.util.List;
import java.util.Set;

/**
 * One catalog entry. {@code index} is the dense integer id used inside tries and indexes;
 * {@code id} is the stable external id (e.g. "EX0042").
 */
public record Exercise(
        int index,
        String id,
        String name,
        List<String> primaryMuscles,
        List<String> secondaryMuscles,
        List<String> equipment,
        String movementPattern,
        List<String> tags,
        String instructions) {

    public static final Set<String> MOVEMENT_PATTERNS =
            Set.of("push", "pull", "hinge", "squat", "carry", "rotation", "isolation");

    public Exercise withIndex(int newIndex) {
        return new Exercise(newIndex, id, name, primaryMuscles, secondaryMuscles, equipment,
                movementPattern, tags, instructions);
    }
}
