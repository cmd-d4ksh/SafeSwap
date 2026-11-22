package com.exsub.service;

import com.exsub.algo.KmpMatcher;
import com.exsub.algo.Trie;
import com.exsub.algo.baseline.NaiveMatcher;
import com.exsub.engine.CatalogIndex;
import com.exsub.error.ApiException;
import com.exsub.model.Exercise;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Trie autocomplete (name / tag) and KMP instruction-text search. */
@Service
public class SearchService {

    public static final int MAX_LIMIT = 50;

    public record ExerciseRef(String id, String name, String matchedKey) { }

    public record TagSuggestion(String tag, int exerciseCount, List<String> sampleExercises) { }

    public record AutocompleteResponse(String prefix, String mode, String method, int trieNodes, int nodesVisited,
                                       int keysMatched, long elapsedMicros, List<ExerciseRef> exercises,
                                       List<TagSuggestion> tags) { }

    public record TextMatch(String id, String name, List<Integer> positions, String snippet) { }

    public record TextSearchResponse(String phrase, String method, int textsScanned, int matches,
                                     long kmpComparisons, long naiveComparisons, long elapsedMicros,
                                     List<TextMatch> results) { }

    private final CatalogService catalogService;

    public SearchService(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    public AutocompleteResponse autocomplete(String prefix, String mode, int limit) {
        CatalogIndex catalog = catalogService.snapshot().catalog();
        if (catalog.isEmpty()) throw ApiException.catalogEmpty();
        if (prefix == null || prefix.isBlank()) {
            throw ApiException.badRequest("PREFIX_REQUIRED", "Query parameter 'prefix' must not be blank.", List.of());
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw ApiException.badRequest("INVALID_LIMIT", "limit must be between 1 and " + MAX_LIMIT + ".", List.of());
        }
        String m = mode == null ? "name" : mode.trim().toLowerCase();
        long t0 = System.nanoTime();
        if (m.equals("name")) {
            Trie trie = catalog.nameTrie();
            // fetch extra keys because several suffix keys can point to the same exercise
            Trie.SearchResult r = trie.searchPrefix(prefix, limit * 4);
            Set<Integer> seen = new LinkedHashSet<>();
            List<ExerciseRef> out = new ArrayList<>();
            for (Trie.Match match : r.matches()) {
                for (Integer idx : match.ids()) {
                    if (out.size() >= limit) break;
                    if (seen.add(idx)) {
                        Exercise ex = catalog.get(idx);
                        out.add(new ExerciseRef(ex.id(), ex.name(), match.key()));
                    }
                }
            }
            return new AutocompleteResponse(prefix, "name", "Trie prefix walk over names + word suffixes",
                    trie.nodeCount(), r.nodesVisited(), r.matches().size(), (System.nanoTime() - t0) / 1000, out, List.of());
        }
        if (m.equals("tag")) {
            Trie trie = catalog.tagTrie();
            Trie.SearchResult r = trie.searchPrefix(prefix, limit);
            List<TagSuggestion> tags = new ArrayList<>();
            for (Trie.Match match : r.matches()) {
                List<String> sample = new ArrayList<>();
                for (int i = 0; i < Math.min(5, match.ids().size()); i++) sample.add(catalog.get(match.ids().get(i)).name());
                tags.add(new TagSuggestion(match.key(), match.ids().size(), sample));
            }
            return new AutocompleteResponse(prefix, "tag", "Trie prefix walk over tags / muscles / equipment / patterns",
                    trie.nodeCount(), r.nodesVisited(), r.matches().size(), (System.nanoTime() - t0) / 1000, List.of(), tags);
        }
        throw ApiException.badRequest("INVALID_MODE", "mode must be 'name' or 'tag'.", List.of("name", "tag"));
    }

    public TextSearchResponse textSearch(String phrase, int limit) {
        CatalogIndex catalog = catalogService.snapshot().catalog();
        if (catalog.isEmpty()) throw ApiException.catalogEmpty();
        if (phrase == null || phrase.isBlank()) {
            throw ApiException.badRequest("PHRASE_REQUIRED", "Query parameter 'q' must not be blank.", List.of());
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw ApiException.badRequest("INVALID_LIMIT", "limit must be between 1 and " + MAX_LIMIT + ".", List.of());
        }
        String p = Trie.normalize(phrase);
        long t0 = System.nanoTime();
        KmpMatcher kmp = new KmpMatcher(p);
        long comparisons = 0;
        int total = 0;
        List<TextMatch> out = new ArrayList<>();
        for (Exercise ex : catalog.all()) {
            List<Integer> pos = kmp.findAll(ex.instructions());
            comparisons += kmp.lastComparisons();
            if (!pos.isEmpty()) {
                total++;
                if (out.size() < limit) out.add(new TextMatch(ex.id(), ex.name(), pos, snippet(ex.instructions(), pos.get(0), p.length())));
            }
        }
        long micros = (System.nanoTime() - t0) / 1000;
        // naive baseline comparisons, reported for transparency (not used for the answer)
        NaiveMatcher naive = new NaiveMatcher();
        long naiveComparisons = 0;
        for (Exercise ex : catalog.all()) {
            naive.findAll(ex.instructions(), p);
            naiveComparisons += naive.lastComparisons();
        }
        return new TextSearchResponse(phrase, "KMP (failure function built once, O(n+m) per text)", catalog.size(),
                total, comparisons, naiveComparisons, micros, out);
    }

    private static String snippet(String text, int pos, int len) {
        int from = Math.max(0, pos - 40);
        int to = Math.min(text.length(), pos + len + 40);
        return (from > 0 ? "…" : "") + text.substring(from, pos) + "[" + text.substring(pos, pos + len) + "]"
                + text.substring(pos + len, to) + (to < text.length() ? "…" : "");
    }
}
