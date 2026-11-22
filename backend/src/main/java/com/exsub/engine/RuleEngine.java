package com.exsub.engine;

import com.exsub.model.Exercise;
import com.exsub.model.InjuryRule;
import com.exsub.model.InjuryRule.Contraindication;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The AUTHORITATIVE safety check. Given an exercise and an injury tag it evaluates every
 * contraindication of that injury against the exercise's movement pattern, tags and equipment,
 * and returns the human-readable reasons it is unsafe (empty list = safe).
 *
 * <p>This is the "exact lookup against the real rule set" that every Bloom-filter positive
 * is confirmed with.
 */
public final class RuleEngine {

    private final Map<String, InjuryRule> rules = new LinkedHashMap<>();

    public RuleEngine(Collection<InjuryRule> ruleList) {
        for (InjuryRule r : ruleList) rules.put(r.tag(), r);
    }

    public boolean isKnownInjury(String tag) { return tag != null && rules.containsKey(tag); }

    public InjuryRule rule(String tag) { return rules.get(tag); }

    public Collection<InjuryRule> rules() { return rules.values(); }

    /** Violations of {@code injuryTag}'s rule by {@code ex}; empty if the exercise is safe. */
    public List<String> evaluate(Exercise ex, String injuryTag) {
        InjuryRule rule = rules.get(injuryTag);
        if (rule == null) throw new IllegalArgumentException("Unknown injury tag: " + injuryTag);
        List<String> violations = new ArrayList<>();
        for (Contraindication c : rule.contraindications()) {
            boolean hit = switch (c.kind()) {
                case PATTERN -> c.value().equals(ex.movementPattern());
                case TAG -> ex.tags().contains(c.value());
                case EQUIPMENT -> ex.equipment().contains(c.value());
            };
            if (hit) {
                violations.add(c.kind().name().toLowerCase() + " '" + c.value() + "': " + c.reason());
            }
        }
        return violations;
    }
}
