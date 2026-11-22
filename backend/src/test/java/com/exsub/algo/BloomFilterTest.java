package com.exsub.algo;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Correctness tests for algorithm unit 2: Bloom filter.
 * Edge/boundary cases are marked [EDGE] in the display name.
 */
class BloomFilterTest {

    private static String member(int i) { return "EX" + i + "|lower-back-strain"; }
    private static String nonMember(int i) { return "NX" + i + "|shoulder-impingement"; }

    /** Empirical FPP over {@code probes} keys that were never inserted. */
    private static double measureFpp(BloomFilter bf, int probes) {
        int fp = 0;
        for (int i = 0; i < probes; i++) if (bf.mightContain(nonMember(i))) fp++;
        return (double) fp / probes;
    }

    @Test
    @DisplayName("B1 no false negatives: every inserted pair is reported as possibly present")
    void noFalseNegatives() {
        BloomFilter bf = BloomFilter.create(5_000, 0.01);
        for (int i = 0; i < 5_000; i++) bf.add(member(i));
        for (int i = 0; i < 5_000; i++) assertTrue(bf.mightContain(member(i)), member(i));
        assertEquals(5_000, bf.insertedCount());
    }

    @Test
    @DisplayName("B2 [EDGE] empty filter (zero contraindications): every query is a definite negative")
    void emptyFilter() {
        BloomFilter bf = BloomFilter.create(100, 0.01);
        for (int i = 0; i < 10_000; i++) assertFalse(bf.mightContain(nonMember(i)));
        assertEquals(0.0, bf.fillRatio());
        assertEquals(0.0, bf.expectedFpp());
    }

    @Test
    @DisplayName("B3 optimal sizing: n=1000, p=0.01 gives m=9586 bits and k=7")
    void sizing() {
        BloomFilter bf = BloomFilter.create(1_000, 0.01);
        assertEquals(9_586, bf.bitSize());
        assertEquals(7, bf.hashCount());
        assertEquals(1_200, bf.memoryBytes(), 8); // 150 longs
    }

    @Test
    @DisplayName("B4 [EDGE] at expected saturation (n inserted) measured FPP is close to target and fill ~50%")
    void atExpectedSaturation() {
        int n = 10_000;
        BloomFilter bf = BloomFilter.create(n, 0.01);
        for (int i = 0; i < n; i++) bf.add(member(i));
        double fpp = measureFpp(bf, 200_000);
        assertTrue(fpp < 0.015, "measured fpp " + fpp);
        assertTrue(fpp > 0.005, "measured fpp suspiciously low " + fpp);
        assertEquals(0.5, bf.fillRatio(), 0.03);
        assertEquals(0.01, bf.expectedFpp(), 0.002);
    }

    @Test
    @DisplayName("B5 [EDGE] over-saturation (5x design capacity) degrades FPP sharply — documents the trade-off")
    void overSaturation() {
        int n = 2_000;
        BloomFilter bf = BloomFilter.create(n, 0.01);
        for (int i = 0; i < 5 * n; i++) bf.add(member(i));
        double fpp = measureFpp(bf, 50_000);
        assertTrue(fpp > 0.4, "expected heavy degradation, got " + fpp);
        assertTrue(bf.fillRatio() > 0.95);
        // no false negatives even when over-full
        for (int i = 0; i < 5 * n; i++) assertTrue(bf.mightContain(member(i)));
    }

    @Test
    @DisplayName("B6 [EDGE] degenerate m=1,k=1: one insertion makes every query a (false) positive")
    void fullySaturatedSingleBit() {
        BloomFilter bf = BloomFilter.withSize(1, 1);
        assertFalse(bf.mightContain("anything"));
        bf.add("x");
        assertTrue(bf.mightContain("anything-else"));
        assertEquals(1.0, bf.fillRatio());
    }

    @Test
    @DisplayName("B7 hand-written hash functions are deterministic and independent")
    void hashFunctions() {
        byte[] a = HashFunctions.bytes("EX0001|lower-back-strain");
        byte[] b = HashFunctions.bytes("EX0002|lower-back-strain");
        assertEquals(HashFunctions.fnv1a64(a), HashFunctions.fnv1a64(a));
        assertNotEquals(HashFunctions.fnv1a64(a), HashFunctions.fnv1a64(b));
        assertNotEquals(HashFunctions.fnv1a64(a), HashFunctions.mixHash64(a, 1));
        // FNV-1a 64 reference value for the empty input is the offset basis
        assertEquals(0xcbf29ce484222325L, HashFunctions.fnv1a64(new byte[0]));
        // FNV-1a 64 published test vector: "a" -> af63dc4c8601ec8c
        assertEquals(0xaf63dc4c8601ec8cL, HashFunctions.fnv1a64(HashFunctions.bytes("a")));
        // allocation-free String variants agree with the byte[] versions on ASCII keys
        String key = "EX0001|lower-back-strain";
        assertEquals(HashFunctions.fnv1a64(a), HashFunctions.fnv1a64(key));
        assertEquals(HashFunctions.mixHash64(a, 99), HashFunctions.mixHash64(key, 99));
    }

    @Test
    @DisplayName("B8 invalid parameters are rejected")
    void invalidParameters() {
        assertThrows(IllegalArgumentException.class, () -> BloomFilter.create(0, 0.01));
        assertThrows(IllegalArgumentException.class, () -> BloomFilter.create(10, 0.0));
        assertThrows(IllegalArgumentException.class, () -> BloomFilter.create(10, 1.0));
        assertThrows(IllegalArgumentException.class, () -> BloomFilter.withSize(0, 3));
        assertThrows(IllegalArgumentException.class, () -> BloomFilter.withSize(64, 0));
    }
}
