package com.exsub.engine;

/**
 * User input for one substitution search.
 *
 * @param exercise          exercise the user cannot do: exact name or id (e.g. "Barbell Back Squat" / "EX0101")
 * @param injuryTag         injury/limitation tag (e.g. "lower-back-strain")
 * @param maxResults        1..50, default 10
 * @param keyword           optional movement cue / phrase matched with KMP against instruction text
 * @param requireKeyword    if true, candidates whose instructions do not contain the keyword are excluded
 * @param sameEquipmentOnly if true, only candidates sharing at least one equipment item are kept
 */
public record SubstitutionRequest(
        String exercise,
        String injuryTag,
        Integer maxResults,
        String keyword,
        Boolean requireKeyword,
        Boolean sameEquipmentOnly) {

    public int maxResultsOrDefault() { return maxResults == null ? 10 : maxResults; }
    public boolean requireKeywordOrDefault() { return Boolean.TRUE.equals(requireKeyword); }
    public boolean sameEquipmentOnlyOrDefault() { return Boolean.TRUE.equals(sameEquipmentOnly); }
}
