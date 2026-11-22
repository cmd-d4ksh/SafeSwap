package com.exsub.bench;

import com.exsub.algo.BloomFilter;
import com.exsub.algo.KmpMatcher;
import com.exsub.algo.Trie;
import com.exsub.algo.baseline.LinearPrefixScan;
import com.exsub.algo.baseline.NaiveMatcher;
import com.exsub.data.CatalogLoader;
import com.exsub.data.ExerciseCatalogGenerator;
import com.exsub.engine.CatalogIndex;
import com.exsub.engine.ContraindicationIndex;
import com.exsub.engine.RuleEngine;
import com.exsub.engine.SubstitutionEngine;
import com.exsub.engine.SubstitutionRequest;
import com.exsub.model.Exercise;
import com.exsub.model.InjuryRule;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.File;
import java.io.InputStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.Set;
import java.util.function.LongSupplier;

/**
 * Benchmark harness (plain System.nanoTime, warm-up + median of measured rounds).
 * <pre>
 *   cd backend
 *   MAVEN_OPTS=-Xmx3g mvn -q compile exec:java -Dexec.mainClass=com.exsub.bench.BenchmarkRunner
 *   # optional args: [outputDir] [comma-separated sizes]
 * </pre>
 * Writes docs/benchmark_results.md and docs/benchmark_results.csv.
 */
public final class BenchmarkRunner {

    private static final int WARMUP = 2;
    private static final int ROUNDS = 5;
    private static final String[] PHRASES = {
        "neutral spine", "deep knee flexion", "overhead", "brace hard before each rep", "stress on the knee joint"
    };

    private static long sink; // defeats dead-code elimination

    public static void main(String[] args) throws Exception {
        String outDir = args.length > 0 ? args[0] : "../docs";
        int[] sizes = args.length > 1
                ? Arrays.stream(args[1].split(",")).mapToInt(Integer::parseInt).toArray()
                : new int[]{100, 1_000, 10_000, 50_000};

        List<InjuryRule> rules;
        try (InputStream in = BenchmarkRunner.class.getResourceAsStream("/data/injury_rules.json")) {
            rules = new ObjectMapper().readValue(in, new TypeReference<List<InjuryRule>>() { });
        }

        List<String[]> rows = new ArrayList<>();
        StringBuilder md = new StringBuilder();
        md.append("# Benchmark results\n\n");
        md.append("Generated ").append(LocalDateTime.now().withNano(0)).append(" on Java ")
                .append(System.getProperty("java.version")).append(", ").append(System.getProperty("os.name"))
                .append(" ").append(System.getProperty("os.arch")).append(", ")
                .append(Runtime.getRuntime().availableProcessors()).append(" cores.\n\n");
        md.append("Method: synthetic catalogs from `ExerciseCatalogGenerator.scaled(N, 42)`; ").append(WARMUP)
                .append(" warm-up rounds then median of ").append(ROUNDS)
                .append(" measured rounds, `System.nanoTime()`. Times are per operation.\n\n");

        md.append("## 1. Prefix search: Trie vs linear scan (top-10 autocomplete, 500 queries)\n\n");
        md.append("| N exercises | indexed keys | trie nodes | Trie µs/query | Linear scan µs/query | speed-up |\n|---|---|---|---|---|---|\n");
        StringBuilder kmpMd = new StringBuilder("## 2. Phrase search over instruction text: KMP vs naive (5 phrases, all N texts)\n\n"
                + "| N exercises | text chars scanned | KMP ms/phrase | Naive ms/phrase | KMP comparisons | Naive comparisons | comparison ratio |\n|---|---|---|---|---|---|---|\n");
        StringBuilder advMd = new StringBuilder("### 2b. Adversarial text (`a…ab`, pattern `a`×29 + `b`): worst case for naive matching\n\n"
                + "| text length | KMP ms | Naive ms | KMP comparisons | Naive comparisons | comparison ratio |\n|---|---|---|---|---|---|\n");
        StringBuilder bloomMd =new StringBuilder("## 3. Contraindication check: Bloom filter vs HashSet vs rule engine (all N×12 pairs)\n\n"
                + "| N exercises | contraindicated pairs n | Bloom m (bits) | k | Bloom ns/check | HashSet ns/check | Rule-engine ns/check | Bloom memory | HashSet memory (est.) | memory ratio | target FPP | measured FPP |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n");
        StringBuilder pipeMd = new StringBuilder("## 4. End-to-end substitution request: Bloom pre-check vs rule-engine-on-every-candidate\n\n"
                + "| N exercises | avg candidates / request | Bloom pipeline µs/request | Rule-only µs/request | rule evaluations avoided |\n|---|---|---|---|---|\n");

        for (int n : sizes) {
            System.out.println("== N = " + n);
            CatalogLoader.Result loaded = CatalogLoader.load(ExerciseCatalogGenerator.scaled(n, 42L));
            List<Exercise> exercises = loaded.exercises();
            CatalogIndex catalog = new CatalogIndex(exercises);
            Random rnd = new Random(1);

            // ---------- 1. Trie vs linear ----------
            LinearPrefixScan linear = new LinearPrefixScan();
            for (Exercise ex : exercises) {
                String name = Trie.normalize(ex.name());
                linear.insert(name, ex.index());
                for (int i = 1; i < name.length(); i++) {
                    char prev = name.charAt(i - 1);
                    if (prev == ' ' || prev == '-') linear.insert(name.substring(i), ex.index());
                }
            }
            List<String> prefixes = new ArrayList<>();
            for (int i = 0; i < 500; i++) {
                String name = Trie.normalize(exercises.get(rnd.nextInt(exercises.size())).name());
                String[] words = name.split(" ");
                String w = String.join(" ", Arrays.copyOfRange(words, rnd.nextInt(words.length), words.length));
                prefixes.add(w.substring(0, Math.min(w.length(), 1 + rnd.nextInt(6))));
            }
            Trie trie = catalog.nameTrie();
            double trieUs = median(() -> {
                long s = 0;
                for (String p : prefixes) s += trie.searchPrefix(p, 10).matches().size();
                return s;
            }) / prefixes.size() / 1000.0;
            double linUs = median(() -> {
                long s = 0;
                for (String p : prefixes) s += linear.searchPrefixKeys(p, 10).size();
                return s;
            }) / prefixes.size() / 1000.0;
            md.append(String.format(Locale.ROOT, "| %,d | %,d | %,d | %.2f | %.2f | %.1fx |%n",
                    n, linear.size(), trie.nodeCount(), trieUs, linUs, linUs / trieUs));
            rows.add(new String[]{"prefix", "" + n, fmt(trieUs), fmt(linUs)});

            // ---------- 2. KMP vs naive ----------
            long chars = 0;
            for (Exercise ex : exercises) chars += ex.instructions().length();
            long[] kmpCmp = {0};
            long[] naiveCmp = {0};
            double kmpMs = median(() -> {
                long s = 0;
                kmpCmp[0] = 0;
                for (String phrase : PHRASES) {
                    KmpMatcher k = new KmpMatcher(phrase);
                    for (Exercise ex : exercises) {
                        s += k.findAll(ex.instructions()).size();
                        kmpCmp[0] += k.lastComparisons();
                    }
                }
                return s;
            }) / PHRASES.length / 1e6;
            NaiveMatcher naive = new NaiveMatcher();
            double naiveMs = median(() -> {
                long s = 0;
                naiveCmp[0] = 0;
                for (String phrase : PHRASES) {
                    for (Exercise ex : exercises) {
                        s += naive.findAll(ex.instructions(), phrase).size();
                        naiveCmp[0] += naive.lastComparisons();
                    }
                }
                return s;
            }) / PHRASES.length / 1e6;
            kmpMd.append(String.format(Locale.ROOT, "| %,d | %,d | %.3f | %.3f | %,d | %,d | %.2f |%n",
                    n, chars, kmpMs, naiveMs, kmpCmp[0], naiveCmp[0], (double) naiveCmp[0] / kmpCmp[0]));
            rows.add(new String[]{"phrase", "" + n, fmt(kmpMs * 1000), fmt(naiveMs * 1000)});

            // ---------- 2b. adversarial (repetitive) text: worst case for naive ----------
            int advLen = n * 300; // same order of magnitude as the real instruction corpus
            String advText = "a".repeat(advLen - 1) + "b";
            String advPat = "a".repeat(29) + "b";
            KmpMatcher advKmp = new KmpMatcher(advPat);
            double advKmpMs = median(() -> advKmp.findAll(advText).size()) / 1e6;
            long advKmpCmp = advKmp.lastComparisons();
            double advNaiveMs = median(() -> naive.findAll(advText, advPat).size()) / 1e6;
            long advNaiveCmp = naive.lastComparisons();
            advMd.append(String.format(Locale.ROOT, "| %,d | %.3f | %.3f | %,d | %,d | %.1f |%n",
                    advLen, advKmpMs, advNaiveMs, advKmpCmp, advNaiveCmp, (double) advNaiveCmp / advKmpCmp));
            rows.add(new String[]{"phrase-adversarial", "" + advLen, fmt(advKmpMs * 1000), fmt(advNaiveMs * 1000)});

            // ---------- 3. Bloom vs HashSet vs rule engine ----------
            RuleEngine engine = new RuleEngine(rules);
            ContraindicationIndex ci = ContraindicationIndex.build(exercises, engine, 0.01);
            List<String> tags = new ArrayList<>();
            for (InjuryRule r : rules) tags.add(r.tag());
            List<String> queryKeys = new ArrayList<>();
            List<Exercise> queryEx = new ArrayList<>();
            List<String> queryTag = new ArrayList<>();
            for (Exercise ex : exercises) {
                for (String t : tags) {
                    queryKeys.add(ContraindicationIndex.key(ex.id(), t));
                    queryEx.add(ex);
                    queryTag.add(t);
                }
            }
            Set<String> exact = new HashSet<>();
            for (int i = 0; i < queryKeys.size(); i++) {
                if (ci.exactContains(queryEx.get(i).id(), queryTag.get(i))) exact.add(queryKeys.get(i));
            }
            BloomFilter bloom = ci.bloom();
            double bloomNs = median(() -> {
                long s = 0;
                for (String k : queryKeys) if (bloom.mightContain(k)) s++;
                return s;
            }) / queryKeys.size();
            double setNs = median(() -> {
                long s = 0;
                for (String k : queryKeys) if (exact.contains(k)) s++;
                return s;
            }) / queryKeys.size();
            double ruleNs = median(() -> {
                long s = 0;
                for (int i = 0; i < queryEx.size(); i++) s += engine.evaluate(queryEx.get(i), queryTag.get(i)).size();
                return s;
            }) / queryEx.size();
            long setBytes = estimateHashSetBytes(exact);
            double fpp = ci.measuredFalsePositiveRate(exercises, tags);
            bloomMd.append(String.format(Locale.ROOT,
                    "| %,d | %,d | %,d | %d | %.1f | %.1f | %.1f | %s | %s | %.1fx | %.3f | %.4f |%n",
                    n, ci.pairCount(), bloom.bitSize(), bloom.hashCount(), bloomNs, setNs, ruleNs,
                    human(bloom.memoryBytes()), human(setBytes), (double) setBytes / bloom.memoryBytes(),
                    bloom.targetFpp(), fpp));
            rows.add(new String[]{"membership", "" + n, fmt(bloomNs), fmt(setNs)});

            // ---------- 4. end-to-end pipeline ----------
            SubstitutionEngine withBloom = new SubstitutionEngine(catalog, engine, ci);
            SubstitutionEngine ruleOnly = new SubstitutionEngine(catalog, engine,
                    ContraindicationIndex.buildWithFilter(exercises, engine, BloomFilter.withSize(8, 1)));
            List<SubstitutionRequest> reqs = new ArrayList<>();
            long candTotal = 0;
            long avoided = 0;
            for (int i = 0; i < 40; i++) {
                Exercise target = exercises.get(rnd.nextInt(exercises.size()));
                SubstitutionRequest r = new SubstitutionRequest(target.id(), tags.get(rnd.nextInt(tags.size())), 10, null, null, null);
                reqs.add(r);
                var res = withBloom.substitute(r);
                candTotal += res.pipeline().candidatesConsidered();
                avoided += res.pipeline().ruleEvaluationsAvoided();
            }
            double bloomPipeUs = median(() -> {
                long s = 0;
                for (SubstitutionRequest r : reqs) s += withBloom.substitute(r).results().size();
                return s;
            }) / reqs.size() / 1000.0;
            double rulePipeUs = median(() -> {
                long s = 0;
                for (SubstitutionRequest r : reqs) s += ruleOnly.substitute(r).results().size();
                return s;
            }) / reqs.size() / 1000.0;
            pipeMd.append(String.format(Locale.ROOT, "| %,d | %,d | %.1f | %.1f | %.1f%% |%n",
                    n, candTotal / reqs.size(), bloomPipeUs, rulePipeUs, 100.0 * avoided / Math.max(1, candTotal)));
            rows.add(new String[]{"pipeline", "" + n, fmt(bloomPipeUs), fmt(rulePipeUs)});
        }

        md.append('\n').append(kmpMd).append('\n').append(advMd).append('\n').append(bloomMd).append('\n').append(pipeMd).append('\n');
        md.append("HashSet memory is an analytic estimate for a 64-bit JVM with compressed oops: per entry "
                + "32 B HashMap.Node + 24 B String header + (16 B + key length) byte[] rounded to 8 B, plus a "
                + "4 B table slot per bucket at load factor 0.75.\n");

        File dir = new File(outDir);
        dir.mkdirs();
        try (PrintWriter w = new PrintWriter(new File(dir, "benchmark_results.md"), StandardCharsets.UTF_8)) {
            w.print(md);
        }
        try (PrintWriter w = new PrintWriter(new File(dir, "benchmark_results.csv"), StandardCharsets.UTF_8)) {
            w.println("experiment,n,algorithm_value,baseline_value");
            for (String[] r : rows) w.println(String.join(",", r));
        }
        System.out.println(md);
        System.out.println("(sink " + sink + ")");
    }

    /** Runs warm-up rounds, then returns the median wall time (ns) of the measured rounds. */
    private static double median(LongSupplier work) {
        for (int i = 0; i < WARMUP; i++) sink += work.getAsLong();
        long[] t = new long[ROUNDS];
        for (int i = 0; i < ROUNDS; i++) {
            long t0 = System.nanoTime();
            sink += work.getAsLong();
            t[i] = System.nanoTime() - t0;
        }
        Arrays.sort(t);
        return t[ROUNDS / 2];
    }

    static long estimateHashSetBytes(Set<String> set) {
        long bytes = 0;
        for (String s : set) {
            long arr = 16 + s.length();
            arr = (arr + 7) / 8 * 8;
            bytes += 32 + 24 + arr;
        }
        long buckets = Integer.highestOneBit((int) Math.max(16, set.size() / 0.75) - 1) << 1;
        return bytes + buckets * 4 + 48;
    }

    private static String human(long bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return String.format(Locale.ROOT, "%.1f KB", bytes / 1024.0);
        return String.format(Locale.ROOT, "%.2f MB", bytes / (1024.0 * 1024));
    }

    private static String fmt(double v) { return String.format(Locale.ROOT, "%.4f", v); }
}
