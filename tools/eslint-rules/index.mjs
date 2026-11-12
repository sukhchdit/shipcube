/**
 * Local ESLint plugin of the repository (flat config key `platform`). One rule per file; each rule has a seeded
 * negative fixture under tests/fixtures/lint (tools/lint/negative-fixtures.test.ts).
 */
import anyJustification from './any-justification.mjs';
import auditWriterAllowlist from './audit-writer-allowlist.mjs';
import barrelReexportOnly from './barrel-reexport-only.mjs';
import moneyArith from './money-arith.mjs';
import noInnerhtml from './no-innerhtml.mjs';
import noToFixedToLocaleString from './no-tofixed-tolocalestring.mjs';
import nodePathOnly from './node-path-only.mjs';
import outboundHttpViaClient from './outbound-http-via-client.mjs';

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: '@platform/eslint-rules', version: '0.0.0' },
  rules: {
    'any-justification': anyJustification,
    'audit-writer-allowlist': auditWriterAllowlist,
    'barrel-reexport-only': barrelReexportOnly,
    'money-arith': moneyArith,
    'no-innerhtml': noInnerhtml,
    'no-tofixed-tolocalestring': noToFixedToLocaleString,
    'node-path-only': nodePathOnly,
    'outbound-http-via-client': outboundHttpViaClient,
  },
};

export default plugin;
