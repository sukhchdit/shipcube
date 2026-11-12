interface Escaped {
  readonly _originalClient: unknown;
}

export const root = (db: Escaped): unknown => db._originalClient;
