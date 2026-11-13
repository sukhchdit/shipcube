export function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`invalid payload: ${(error as Error).message}`, { cause: error });
  }
}
