/**
 * Local ESLint plugin of the repository (flat config key `platform`). One rule per file; each rule has a seeded
 * negative fixture under tests/fixtures/lint (tools/lint/negative-fixtures.test.ts).
 */
import anyJustification from './any-justification.mjs';
import auditWriterAllowlist from './audit-writer-allowlist.mjs';
import barrelReexportOnly from './barrel-reexport-only.mjs';
import dbRawSql from './db-raw-sql.mjs';
import expectAffected from './expect-affected.mjs';
import moneyArith from './money-arith.mjs';
import noAlterRoleSql from './no-alter-role-sql.mjs';
import noCatchMessageInterpolation from './no-catch-message-interpolation.mjs';
import noExternalCallsInTenantTx from './no-external-calls-in-tenant-tx.mjs';
import noInnerhtml from './no-innerhtml.mjs';
import noRawRequestInLog from './no-raw-request-in-log.mjs';
import noToFixedToLocaleString from './no-tofixed-tolocalestring.mjs';
import nodePathOnly from './node-path-only.mjs';
import outboundHttpViaClient from './outbound-http-via-client.mjs';
import prismaClientConstruction from './prisma-client-construction.mjs';
import staticModuleSpecifier from './static-module-specifier.mjs';
import systemModelOwner from './system-model-owner.mjs';
import tenantContextSql from './tenant-context-sql.mjs';

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: '@platform/eslint-rules', version: '0.0.0' },
  rules: {
    'any-justification': anyJustification,
    'audit-writer-allowlist': auditWriterAllowlist,
    'barrel-reexport-only': barrelReexportOnly,
    'db-raw-sql': dbRawSql,
    'expect-affected': expectAffected,
    'money-arith': moneyArith,
    'no-alter-role-sql': noAlterRoleSql,
    'no-catch-message-interpolation': noCatchMessageInterpolation,
    'no-external-calls-in-tenant-tx': noExternalCallsInTenantTx,
    'no-innerhtml': noInnerhtml,
    'no-raw-request-in-log': noRawRequestInLog,
    'no-tofixed-tolocalestring': noToFixedToLocaleString,
    'node-path-only': nodePathOnly,
    'outbound-http-via-client': outboundHttpViaClient,
    'prisma-client-construction': prismaClientConstruction,
    'static-module-specifier': staticModuleSpecifier,
    'system-model-owner': systemModelOwner,
    'tenant-context-sql': tenantContextSql,
  },
};

export default plugin;
