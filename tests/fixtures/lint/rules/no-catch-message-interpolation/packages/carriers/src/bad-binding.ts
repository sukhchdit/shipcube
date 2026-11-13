export function attempt(step: () => void): string {
  try {
    step();
    return 'ok';
  } catch (error) {
    return `step failed: ${error as string}`;
  }
}
