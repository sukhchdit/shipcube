/**
 * Typed message lookup over `locales/{lng}/common.json`, the files and key paths TASK-042 keeps when it replaces this
 * module with react-i18next + ICU. No literal UI string appears in components: they call `translate` / `useT`.
 * Keys are dot paths into the JSON. Because `es` and `fr` must be assignable to the shape of `en`, a missing key in
 * any locale is a compile error; TASK-042 adds the CI parity and ICU placeholder checks.
 */
import en from '../../locales/en/common.json';
import es from '../../locales/es/common.json';
import fr from '../../locales/fr/common.json';
import { DEFAULT_LOCALE, type Locale } from './locales';

export type Messages = typeof en;

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Messages>;

const CATALOGUES: Record<Locale, Messages> = { en, es, fr };

function lookup(catalogue: Messages, key: string): string | undefined {
  let node: unknown = catalogue;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** A key missing in the active locale falls back to `en` (DR-A18); a key missing everywhere renders the key itself. */
export function translate(locale: Locale, key: MessageKey): string {
  return lookup(CATALOGUES[locale], key) ?? lookup(CATALOGUES[DEFAULT_LOCALE], key) ?? key;
}

export type Translate = (key: MessageKey) => string;

export function createTranslator(locale: Locale): Translate {
  return (key) => translate(locale, key);
}
