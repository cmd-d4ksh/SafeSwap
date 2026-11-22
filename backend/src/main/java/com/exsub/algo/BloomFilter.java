package com.exsub.algo;

/**
 * Hand-written Bloom filter over strings.
 *
 * <p>Sizing for n expected insertions and target false-positive probability p:
 * <pre>
 *   m = ceil( -n · ln p / (ln 2)^2 )      bits
 *   k = max(1, round( (m / n) · ln 2 ))   hash functions
 * </pre>
 * The k bit positions are derived with Kirsch–Mitzenmacher double hashing,
 * {@code g_i(x) = h1(x) + i·h2(x)  (mod m)}, from two independent hand-written hashes
 * (FNV-1a 64 and a multiply-rotate hash with a Murmur-style finaliser).
 *
 * <p>Semantics: {@link #mightContain} returning {@code false} is definitive ("definitely not in
 * the set"); returning {@code true} only means "possibly in the set". Callers in this project
 * ALWAYS confirm a positive with the authoritative rule engine before reporting anything as
 * unsafe.
 */
public final class BloomFilter {

    private static final double LN2 = Math.log(2);
    private static final long SEED = 0x5bd1e9955bd1e995L;

    private final BitArray bits;
    private final long m;
    private final int k;
    private final int expectedInsertions;
    private final double targetFpp;
    private long inserted;

    private BloomFilter(long m, int k, int expectedInsertions, double targetFpp) {
        if (m <= 0) throw new IllegalArgumentException("m must be > 0");
        if (k <= 0) throw new IllegalArgumentException("k must be > 0");
        this.m = m;
        this.k = k;
        this.bits = new BitArray(m);
        this.expectedInsertions = expectedInsertions;
        this.targetFpp = targetFpp;
    }

    /** Optimal sizing for the expected number of elements and target false-positive rate. */
    public static BloomFilter create(int expectedInsertions, double targetFpp) {
        if (expectedInsertions <= 0) throw new IllegalArgumentException("expectedInsertions must be > 0");
        if (!(targetFpp > 0.0 && targetFpp < 1.0)) throw new IllegalArgumentException("targetFpp must be in (0,1)");
        long m = optimalBits(expectedInsertions, targetFpp);
        int k = optimalHashes(expectedInsertions, m);
        return new BloomFilter(m, k, expectedInsertions, targetFpp);
    }

    /** Explicit sizing (used by tests and by the saturation demo). */
    public static BloomFilter withSize(long m, int k) {
        return new BloomFilter(m, k, 0, Double.NaN);
    }

    public static long optimalBits(long n, double p) {
        return Math.max(1, (long) Math.ceil(-n * Math.log(p) / (LN2 * LN2)));
    }

    public static int optimalHashes(long n, long m) {
        return Math.max(1, (int) Math.round((double) m / n * LN2));
    }

    public void add(String item) {
        long h1 = HashFunctions.fnv1a64(item);
        long h2 = HashFunctions.mixHash64(item, SEED) | 1L; // odd step => visits distinct slots
        for (int i = 0; i < k; i++) {
            bits.set(Math.floorMod(h1 + i * h2, m));
        }
        inserted++;
    }

    /** false => definitely absent. true => POSSIBLY present (must be confirmed). */
    public boolean mightContain(String item) {
        long h1 = HashFunctions.fnv1a64(item);
        long h2 = HashFunctions.mixHash64(item, SEED) | 1L;
        for (int i = 0; i < k; i++) {
            if (!bits.get(Math.floorMod(h1 + i * h2, m))) return false;
        }
        return true;
    }

    /** Theoretical FPP for the current number of insertions: (1 - e^{-kn/m})^k. */
    public double expectedFpp() {
        return Math.pow(1 - Math.exp(-(double) k * inserted / m), k);
    }

    /** Fraction of bits set to 1; ~0.5 at design capacity with optimal k. */
    public double fillRatio() { return (double) bits.bitsSet() / m; }

    /** FPP estimated from the actual fill ratio: (bitsSet/m)^k. */
    public double fppFromFill() { return Math.pow(fillRatio(), k); }

    public long bitSize() { return m; }
    public int hashCount() { return k; }
    public long insertedCount() { return inserted; }
    public int expectedInsertions() { return expectedInsertions; }
    public double targetFpp() { return targetFpp; }
    public long memoryBytes() { return bits.memoryBytes(); }
    public long bitsSet() { return bits.bitsSet(); }
}
