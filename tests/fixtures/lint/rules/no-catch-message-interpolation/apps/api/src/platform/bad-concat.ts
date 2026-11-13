export function load(read: () => string): string {
  try {
    return read();
  } catch (e) {
    return 'load failed: ' + String(e);
  }
}
