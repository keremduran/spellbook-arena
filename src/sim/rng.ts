/** Small seeded PRNG (mulberry32) so matches and tests are reproducible. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** n distinct items from arr (or all of them if n >= length). */
  sample<T>(arr: readonly T[], n: number): T[] {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    const total = items.reduce((s, it) => s + weight(it), 0);
    let r = this.next() * total;
    for (const it of items) {
      r -= weight(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  /** n distinct items, each pick weighted (sampling without replacement). */
  weightedSample<T>(arr: readonly T[], n: number, weight: (t: T) => number): T[] {
    const pool = arr.slice();
    const out: T[] = [];
    while (out.length < n && pool.length) {
      const it = this.weighted(pool, weight);
      out.push(it);
      pool.splice(pool.indexOf(it), 1);
    }
    return out;
  }
}
