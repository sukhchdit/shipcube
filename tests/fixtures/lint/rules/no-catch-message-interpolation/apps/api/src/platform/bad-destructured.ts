export function run(task: () => void): string | undefined {
  try {
    task();
    return undefined;
  } catch ({ message }) {
    return `task failed: ${String(message)}`;
  }
}
