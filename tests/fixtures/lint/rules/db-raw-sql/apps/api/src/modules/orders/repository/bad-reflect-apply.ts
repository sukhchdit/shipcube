interface RawClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** PR11-SEC-17 a: $executeRaw passed to Reflect.apply with a caller-built argument list (no template tag). */
export const run = (db: RawClient, args: unknown[]): unknown => Reflect.apply(db.$executeRaw, db, args);
