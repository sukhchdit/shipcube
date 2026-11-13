/**
 * Path globs of the local rules' options (`*` within a segment, `**` across segments), matched against a POSIX path
 * relative to the ESLint `cwd` (the repository root, or a lint fixture root).
 */
import { relative, sep } from 'node:path';

/**
 * A path glob as an anchored regular expression.
 * @param {string} glob
 * @returns {RegExp}
 */
export const globPattern = (glob) =>
  new RegExp(
    `^${glob
      .split('**')
      .map((part) =>
        part
          .split('*')
          .map((text) => text.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
          .join('[^/]*'),
      )
      .join('.*')}$`,
    'u',
  );

/**
 * The linted file as a POSIX path relative to the ESLint `cwd`.
 * @param {{ cwd: string; filename: string }} context
 * @returns {string}
 */
export const relativeFile = (context) => relative(context.cwd, context.filename).split(sep).join('/');
