/**
 * Deterministic pseudo-randomness.
 *
 * Question order, distractor choice and (later) seeded row data must be
 * identical for the same repo and seed on any machine. Math.random would make
 * a quiz unreproducible and a failed answer unarguable.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Uniform choice. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates copy; the input is untouched. */
  shuffle<T>(items: readonly T[]): T[];
  /** Up to n distinct items, in shuffled order. */
  sample<T>(items: readonly T[], n: number): T[];
}

/** mulberry32 — small, fast, and stable across engines. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => (n <= 0 ? 0 : Math.floor(next() * n));
  const pick = <T,>(items: readonly T[]): T => items[int(items.length)]!;
  const shuffle = <T,>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  const sample = <T,>(items: readonly T[], n: number): T[] => shuffle(items).slice(0, n);
  return { next, int, pick, shuffle, sample };
}

/** Stable 32-bit hash, for deriving a seed from a repo path or question id. */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
