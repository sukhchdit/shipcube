interface RawClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** Code review R1-n3 (PR #54): the raw-statement check runs in package sources too (`only: ['statement']`). */
export const settle = (db: RawClient): Promise<number> => db.$executeRaw`COMMIT`;
