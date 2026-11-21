/**
 * A size-bounded map for the per-instance fallback stores (PR041-SEC-01, R1-m5; TASK-041). The fallback serves the
 * security classes during a Valkey outage, so a key flood (a client with a /48 owns 65,536 /64 keys) must cost O(1) per
 * new key, not a scan of every entry: a new key sweeps at most {@link SWEEP_PER_INSERT} entries from the head of the
 * insertion-ordered `Map`, dropping the expired ones, and at the bound the oldest-inserted entry goes. Never imported by
 * production code outside platform/rate-limit.
 */

/** Entries inspected from the head per new key (a constant, so the cost per insert is O(1)). */
export const SWEEP_PER_INSERT = 8;

export class BoundedMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(
    private readonly maxEntries: number,
    private readonly expired: (value: V) => boolean,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    return this.entries.get(key);
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  /** Replaces the value of a known key in place (its age is unchanged), or inserts a new key within the bound. */
  set(key: K, value: V): void {
    if (this.entries.has(key)) {
      this.entries.set(key, value);
      return;
    }
    let inspected = 0;
    for (const [oldKey, oldValue] of this.entries) {
      if (inspected >= SWEEP_PER_INSERT) break;
      inspected += 1;
      if (this.expired(oldValue)) this.entries.delete(oldKey);
    }
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) this.entries.delete(oldest.value);
    }
    this.entries.set(key, value);
  }
}
