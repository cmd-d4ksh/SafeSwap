package com.exsub.algo;

import java.nio.charset.StandardCharsets;

/**
 * Two independent, hand-written 64-bit hash functions used by {@link BloomFilter}.
 * No library hashing (String.hashCode, Objects.hash, Guava, ...) is used.
 */
public final class HashFunctions {

    private HashFunctions() { }

    private static final long FNV_OFFSET = 0xcbf29ce484222325L;
    private static final long FNV_PRIME = 0x100000001b3L;

    /** FNV-1a, 64-bit: xor the byte in, then multiply by the FNV prime. */
    public static long fnv1a64(byte[] data) {
        long h = FNV_OFFSET;
        for (byte b : data) {
            h ^= (b & 0xff);
            h *= FNV_PRIME;
        }
        return h;
    }

    /**
     * Multiply–rotate hash with a MurmurHash3-style 64-bit finaliser ("fmix64").
     * Different seed, constants and mixing structure from FNV-1a, so the two hashes are
     * effectively independent for double hashing.
     */
    public static long mixHash64(byte[] data, long seed) {
        long h = seed ^ (data.length * 0xc6a4a7935bd1e995L);
        for (byte b : data) {
            h ^= (b & 0xff);
            h *= 0x9E3779B97F4A7C15L;          // golden-ratio constant
            h = Long.rotateLeft(h, 31);
        }
        return fmix64(h);
    }

    /** Avalanche finaliser: every input bit affects every output bit. */
    public static long fmix64(long k) {
        k ^= k >>> 33;
        k *= 0xff51afd7ed558ccdL;
        k ^= k >>> 33;
        k *= 0xc4ceb9fe1a85ec53L;
        k ^= k >>> 33;
        return k;
    }

    /**
     * Allocation-free FNV-1a over a String's UTF-16 code units. ASCII chars are hashed as one
     * byte, so for ASCII input the result equals {@link #fnv1a64(byte[])} of the UTF-8 bytes.
     */
    public static long fnv1a64(CharSequence s) {
        long h = FNV_OFFSET;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            h ^= (c & 0xff);
            h *= FNV_PRIME;
            if (c > 0x7f) {
                h ^= (c >>> 8);
                h *= FNV_PRIME;
            }
        }
        return h;
    }

    /** Allocation-free variant of {@link #mixHash64(byte[], long)} (same ASCII equivalence). */
    public static long mixHash64(CharSequence s, long seed) {
        long h = seed ^ (s.length() * 0xc6a4a7935bd1e995L);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            h ^= (c & 0xff);
            h *= 0x9E3779B97F4A7C15L;
            h = Long.rotateLeft(h, 31);
            if (c > 0x7f) {
                h ^= (c >>> 8);
                h *= 0x9E3779B97F4A7C15L;
                h = Long.rotateLeft(h, 31);
            }
        }
        return fmix64(h);
    }

    public static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
