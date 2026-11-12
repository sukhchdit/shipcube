interface Escaped {
  readonly $parent: unknown;
}

export const unguarded = (db: Escaped): unknown => db[`$parent`];
