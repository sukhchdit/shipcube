/**
 * Host unit test of the GUEST_CAPABLE probe schema and the claim statement (prisma/tests/harness/guest-claim-probe.ts;
 * TASK-051; rulings/wave-1-r-arch-34-operator-rulings.md §2.3, §2.8; D-ARCH-162, D-ARCH-163). The integration suites
 * (guest-claim.int.test.ts, tests/generated/rls/guest-claim-race.int.test.ts) run these statements on PostgreSQL 18.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { renderGuestCapableGuardFunction, renderRls } from '../../../tools/db/render-rls.js';
import { findRepoRoot } from '../../../tools/test-support/process.js';
import { CLAIM_SQL, GC_CHILDREN, GC_DDL, GC_ENTRIES, GC_TABLES, childClaimSql, claimSql, newGuestHash } from './guest-claim-probe.js';

const ddl = GC_DDL.join('\n');
const oneLine = (sql: string): string => sql.replace(/\s+/g, ' ').trim();
const GUARD_MIGRATION = join(findRepoRoot(), 'prisma', 'migrations', '20261120200000_guest_capable_guard', 'migration.sql');

describe('the de-claim guard function has one source (code review R1-m2; PR051-SEC-04)', () => {
  it('[D-ARCH-065] [PR7-SEC-04] migration 20261120200000_guest_capable_guard contains the rendering of the template verbatim, so a template edit without a new migration fails here', () => {
    const rendered = renderGuestCapableGuardFunction();
    const migration = readFileSync(GUARD_MIGRATION, 'utf8').replace(/\r\n/g, '\n');
    expect(rendered).toContain('CREATE FUNCTION platform.guest_capable_guard() RETURNS trigger');
    expect(migration).toContain(rendered);
    // The migration creates the function once, and nothing else besides the REVOKE the template carries.
    expect(migration.match(/CREATE FUNCTION/g)).toHaveLength(1);
    expect(
      migration
        .replace(rendered, '')
        .replace(/^--.*$/gm, '')
        .trim(),
    ).toBe('');
  });
});

describe('guest-claim probe schema (data-model §3.10 as amended; rulings §2.3, §2.8)', () => {
  it('[D-ARCH-162] every child references gc_quotes through the owner-bound pair only, RESTRICT both ways, and no key names gc_quotes (id) alone', () => {
    for (const child of GC_CHILDREN) {
      expect(oneLine(ddl)).toContain(
        `ADD CONSTRAINT fk_${child}__org_id_quote_id FOREIGN KEY (org_id, quote_id) REFERENCES public.gc_quotes (org_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
      );
      expect(oneLine(ddl)).toContain(
        `ADD CONSTRAINT fk_${child}__guest_token_hash_quote_id FOREIGN KEY (guest_token_hash, quote_id) REFERENCES public.gc_quotes (guest_token_hash, id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
      );
    }
    expect(ddl).not.toMatch(/REFERENCES public\.gc_quotes \(id\)/);
    expect(ddl.match(/FOREIGN KEY/g)).toHaveLength(2 * GC_CHILDREN.length + 1); // + the T2-O re-quote key
  });

  it('[D-ARCH-163] every unique index holds an owner column, except the share token digest (the C16 (b) exception shape)', () => {
    const unique = GC_DDL.filter((statement) => statement.startsWith('CREATE UNIQUE INDEX'));
    expect(unique.filter((statement) => !/\((?:org_id|guest_token_hash),/.test(statement))).toEqual([
      'CREATE UNIQUE INDEX ux_gc_quote_shares__share_token_hash ON public.gc_quote_shares (share_token_hash)',
    ]);
    expect(unique).toHaveLength(7);
  });

  it('[D-ARCH-162] every table carries the owner CHECK; gc_quotes carries the T2-O CHECK', () => {
    for (const table of GC_TABLES)
      expect(ddl).toContain(`CONSTRAINT ck_${table}__owner CHECK (num_nonnulls(org_id, guest_token_hash) = 1)`);
    expect(ddl).toContain('CONSTRAINT ck_gc_quotes__requote_org_only CHECK (requote_of_quote_id IS NULL OR org_id IS NOT NULL)');
  });

  it('[PR7-SEC-04] every probe table renders the GUEST_CAPABLE block: tenant, operator and guest policies and the de-claim trigger', () => {
    expect(GC_ENTRIES.map((entry) => entry.name)).toEqual([...GC_TABLES]);
    for (const entry of GC_ENTRIES) {
      const block = renderRls(entry);
      for (const name of ['tenant', 'operator', 'guest'])
        expect(block).toContain(`CREATE POLICY p_${entry.name}__${name} ON public.${entry.name}`);
      expect(block).toContain(`CREATE TRIGGER tg_${entry.name}__guest_capable_guard`);
    }
  });
});

describe('the claim statement (rulings §2.3)', () => {
  it('[D-ARCH-162] is ONE statement: the three child updates are data-modifying CTEs p, o, s of the UPDATE of gc_quotes', () => {
    const sql = oneLine(CLAIM_SQL);
    expect(sql).toMatch(
      /^WITH p AS \(UPDATE public\.gc_quote_packages .*\), o AS \(UPDATE public\.gc_quote_options .*\), s AS \(UPDATE public\.gc_quote_shares .*\) UPDATE public\.gc_quotes SET /,
    );
    expect(sql).toContain(
      'SET org_id = $1::uuid, claimed_by_user_id = $2::uuid, claimed_at = now(), claimed_from_token_hash = guest_token_hash, guest_token_hash = NULL',
    );
    expect(sql.endsWith('WHERE id = $3::uuid AND org_id IS NULL')).toBe(true);
    expect(sql.split(';')).toHaveLength(1);
  });

  it('[D-ARCH-162] every child update clears the hash and binds on org_id IS NULL; a subset leaves the others out; no child means no WITH', () => {
    for (const child of GC_CHILDREN) {
      expect(oneLine(childClaimSql(child))).toBe(
        `UPDATE public.${child} SET org_id = $1::uuid, guest_token_hash = NULL, updated_at = now(), updated_by = $2::uuid, version = version + 1 WHERE quote_id = $3::uuid AND org_id IS NULL`,
      );
    }
    expect(claimSql(['gc_quote_packages'])).not.toContain('gc_quote_shares');
    expect(claimSql([]).startsWith('UPDATE public.gc_quotes')).toBe(true);
    expect(oneLine(claimSql(GC_CHILDREN, 'old.org_id, new.org_id'))).toMatch(/ RETURNING old\.org_id, new\.org_id$/);
  });

  it('a guest hash is 32 random bytes with its lowercase hex context form', () => {
    const one = newGuestHash();
    expect(one.bytes).toHaveLength(32);
    expect(one.hex).toMatch(/^[0-9a-f]{64}$/);
    expect(one.hex).toBe(one.bytes.toString('hex'));
    expect(newGuestHash().hex).not.toBe(one.hex);
  });
});
