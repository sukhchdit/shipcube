import { describe, expect, it } from '@jest/globals';

import en from '../../locales/en/common.json';
import es from '../../locales/es/common.json';
import fr from '../../locales/fr/common.json';
import { LOCALES } from './locales';
import { createTranslator, translate, type MessageKey } from './messages';

const leafKeys = (node: unknown, prefix = ''): string[] =>
  typeof node === 'object' && node !== null
    ? Object.entries(node).flatMap(([key, child]) => leafKeys(child, `${prefix}${key}.`))
    : [prefix.slice(0, -1)];

describe('admin message catalogues (US-115 prerequisite for TASK-042)', () => {
  it('es and fr define exactly the keys of en, with no empty value', () => {
    const keys = leafKeys(en).sort();
    expect(leafKeys(es).sort()).toEqual(keys);
    expect(leafKeys(fr).sort()).toEqual(keys);
    for (const locale of LOCALES) {
      for (const key of keys) expect(translate(locale, key as MessageKey).trim()).not.toBe('');
    }
  });

  it('translates through the active locale', () => {
    expect(translate('es', 'home.title')).toBe('Consola de operadores');
    expect(createTranslator('fr')('home.title')).toBe('Console des opérateurs');
  });

  it('renders the key itself when a key exists nowhere', () => {
    expect(translate('fr', 'nope' as MessageKey)).toBe('nope');
  });
});
