package com.exsub.model;

import java.util.List;

/**
 * Synthetic-but-realistic contraindication rule for one injury/limitation tag.
 * Each {@link Contraindication} says: exercises whose PATTERN / TAG / EQUIPMENT equals
 * {@code value} are unsafe for this injury, because {@code reason}.
 */
public record InjuryRule(
        String tag,
        String name,
        String description,
        String guidance,
        List<Contraindication> contraindications) {

    public enum Kind { PATTERN, TAG, EQUIPMENT }

    public record Contraindication(Kind kind, String value, String reason) { }
}
