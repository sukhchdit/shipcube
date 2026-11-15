/**
 * NODE_OPTIONS parsing shared by the configuration guards (`debugGuard`) and the container entrypoint preflight
 * (`entry-preflight.ts`, TASK-014). Dependency-free on purpose: the preflight imports it before any application
 * code is loaded.
 */

const isSpace = (char: string): boolean => /\s/.test(char);

/**
 * Splits NODE_OPTIONS like Node's parser for quotes: a double-quoted section belongs to the current token with the
 * quotes removed, and `\` escapes the next character inside quotes. It splits on ANY whitespace, which is stricter
 * than Node (U+0020 only); over-splitting can only add refusals (R2-n2).
 */
export function nodeOptionTokens(value: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (quoted && char === '\\') {
      index += 1;
      current += value.charAt(index);
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && isSpace(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    } else {
      current += char;
    }
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/**
 * Option name of a token, normalised: single quotes dropped (Node keeps them, but they mark an intent to pass
 * the flag), the `=value` part removed, `_` read as `-` (Node accepts `--inspect_brk` for `--inspect-brk`), and
 * lower-cased.
 */
export const nodeOptionName = (token: string): string => (token.replace(/'/g, '').split('=', 1)[0] ?? '').replace(/_/g, '-').toLowerCase();

/** Every `--inspect*` option and the `--debug*` aliases (`--debug-port`) configure or start the inspector. */
export const isInspectorOption = (token: string): boolean => {
  const name = nodeOptionName(token);
  return name.startsWith('--inspect') || name.startsWith('--debug');
};
