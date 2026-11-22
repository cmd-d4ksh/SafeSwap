package com.exsub.algo;

/** Fixed-size bit array backed by a long[] (64 bits per word). */
public final class BitArray {

    private final long[] words;
    private final long size;
    private long bitsSet;

    public BitArray(long size) {
        if (size <= 0) throw new IllegalArgumentException("BitArray size must be > 0");
        if (size > (long) Integer.MAX_VALUE * 64) throw new IllegalArgumentException("BitArray too large");
        this.size = size;
        this.words = new long[(int) ((size + 63) >>> 6)];
    }

    /** Sets bit i; returns true if it was previously 0. */
    public boolean set(long i) {
        int w = (int) (i >>> 6);
        long mask = 1L << (i & 63);
        if ((words[w] & mask) != 0) return false;
        words[w] |= mask;
        bitsSet++;
        return true;
    }

    public boolean get(long i) {
        return (words[(int) (i >>> 6)] & (1L << (i & 63))) != 0;
    }

    public long size() { return size; }
    public long bitsSet() { return bitsSet; }
    public long memoryBytes() { return (long) words.length * Long.BYTES; }
}
