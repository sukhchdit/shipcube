/** Reads the apps' message catalogues, so assertions follow the copy instead of duplicating it (TASK-004 stopgap i18n). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCALES = ['en', 'es', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export interface WebMessages {
  skipToContent: string;
  loading: string;
  home: { meta: { title: string }; hero: { title: string } };
  notFound: { title: string; meta: { title: string } };
}

export interface AdminMessages {
  skipToContent: string;
  loading: string;
  home: { title: string };
  notFound: { title: string };
}

function catalogue(app: 'web' | 'admin', locale: Locale): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'apps', app, 'locales', locale, 'common.json'), 'utf8'));
}

export function webMessages(locale: Locale): WebMessages {
  return catalogue('web', locale) as WebMessages;
}

export function adminMessages(locale: Locale): AdminMessages {
  return catalogue('admin', locale) as AdminMessages;
}
