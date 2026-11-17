import { describe, expect, it } from '@jest/globals';
import { ERROR_CATALOGUE } from '@platform/shared';

import en from '../../locales/en/common.json';
import es from '../../locales/es/common.json';
import fr from '../../locales/fr/common.json';
import { errorMessageKey } from './error-messages';
import { translate } from './messages';

describe('error code -> i18n key map (REQ-UI-010; TASK-036)', () => {
  it('has a message in en, es and fr for every catalogue code, and for UNKNOWN', () => {
    const codes = [...Object.keys(ERROR_CATALOGUE), 'UNKNOWN'].sort();
    for (const catalogue of [en, es, fr]) expect(Object.keys(catalogue.errors).sort()).toEqual(codes);
  });

  it('maps a catalogue code to errors.<CODE> and renders it per locale', () => {
    expect(errorMessageKey('AUTHZ_DENIED')).toBe('errors.AUTHZ_DENIED');
    expect(translate('en', errorMessageKey('AUTHZ_DENIED'))).toBe(en.errors.AUTHZ_DENIED);
    expect(translate('fr', errorMessageKey('NOT_FOUND'))).toBe(fr.errors.NOT_FOUND);
  });

  it('maps an unknown, missing or non-string code to errors.UNKNOWN', () => {
    for (const code of ['MY_NEW_ERROR', undefined, null, 42, 'toString']) expect(errorMessageKey(code)).toBe('errors.UNKNOWN');
    expect(translate('es', errorMessageKey('MY_NEW_ERROR'))).toBe(es.errors.UNKNOWN);
  });
});
