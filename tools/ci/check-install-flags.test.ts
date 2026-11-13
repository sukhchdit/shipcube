/**
 * check-install-flags (TASK-007; SEC-TC-32, SEC-TC-45 CI part, SEC-TC-64; ADR-0023 am. F item 1, I items 1-3 and 6,
 * J items 1 (a)/(c), 2 (d) and 6; D-ARCH-040, D-ARCH-041; PR-0005 n8).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import {
  PLATFORM_PIN_LINE,
  checkCommandText,
  checkDockerfile,
  checkInstallFlags,
  checkMigrationsWrite,
  checkNpmrc,
  checkPackageJson,
  nonCanonicalNpmExec,
} from './check-install-flags.mjs';

const repoRoot = findRepoRoot();
const fixtureDir = join(repoRoot, 'tools', 'ci', 'fixtures', 'install-flags');
const script = join(repoRoot, 'tools', 'ci', 'check-install-flags.mjs');
const rootNpmrc = readFileSync(join(repoRoot, '.npmrc'), 'utf8');
const rules = (findings: readonly { rule: string }[]) => findings.map((finding) => finding.rule);
const dockerRules = (name: string) => rules(checkDockerfile(readFileSync(join(fixtureDir, name), 'utf8'), name));

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function tempRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'install-flags-'));
  temps.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

describe('check-install-flags: repository', () => {
  it('SEC-TC-32 / SEC-TC-45: the repository passes (root .npmrc, workflows, package.json scripts)', () => {
    expect(checkInstallFlags(repoRoot).findings).toEqual([]);
  });

  it('CLI: exit 0 on the repository, 1 on a violating tree, 2 on a bad argument', () => {
    expect(runNode([script, '--root', repoRoot], { cwd: repoRoot }).status).toBe(0);
    const bad = tempRepo({ '.npmrc': 'ignore-scripts=true\n', 'package.json': JSON.stringify({ scripts: { setup: 'npm install' } }) });
    const result = runNode([script, '--root', bad], { cwd: repoRoot });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^install-flags: .+ \(package\.json scripts\.setup\)$/m);
    expect(runNode([script, '--nope'], { cwd: repoRoot }).status).toBe(2);
  });
});

describe('.npmrc (ADR-0023 am. I item 1, J item 1 (a))', () => {
  it('D-ARCH-040: the committed root .npmrc passes', () => {
    expect(checkNpmrc(rootNpmrc, '.npmrc')).toEqual([]);
  });

  it('D-ARCH-040: a root .npmrc without the exact @platform pin line fails', () => {
    expect(rules(checkNpmrc(rootNpmrc.replace(PLATFORM_PIN_LINE, '@platform:registry=https://registry.npmjs.org/'), '.npmrc'))).toEqual([
      'npmrc',
    ]);
  });

  it('SEC-TC-45: a later ignore-scripts=false overrides the earlier true and fails', () => {
    expect(rules(checkNpmrc(`${rootNpmrc}\nignore-scripts=false\n`, '.npmrc'))).toEqual(['npmrc']);
  });

  it('ADR-0023 am. I item 1: min-release-age=7 is required', () => {
    expect(rules(checkNpmrc(rootNpmrc.replace('min-release-age=7', ''), '.npmrc'))).toEqual(['npmrc']);
  });

  it('D-ARCH-040: every tools/isolated/*/.npmrc carries the pin; an isolated lockfile without .npmrc fails', () => {
    const root = tempRepo({
      '.npmrc': rootNpmrc,
      'tools/isolated/stryker/.npmrc': rootNpmrc.replace(PLATFORM_PIN_LINE, ''),
      'tools/isolated/lhci/package-lock.json': '{}',
    });
    expect(checkInstallFlags(root).findings.map((f) => `${f.rule} ${f.location}`)).toEqual(
      expect.arrayContaining(['npmrc tools/isolated/stryker/.npmrc', 'npmrc tools/isolated/lhci/.npmrc']),
    );
    expect(checkInstallFlags(root).findings).toHaveLength(2);
  });
});

describe('Dockerfiles (fixtures/install-flags/*.Dockerfile)', () => {
  it('positive control: manifests, lockfile and .npmrc copied first; an inheriting stage may install', () => {
    expect(dockerRules('ok.Dockerfile')).toEqual([]);
  });

  it('D-ARCH-040 (c): npm ci in a stage that copied only the app manifest fails', () => {
    expect(dockerRules('app-manifest-only.Dockerfile')).toEqual(['docker-install-order']);
  });

  it('D-ARCH-040 (c): npm ci in a stage that copied package-lock.json but not .npmrc fails', () => {
    expect(dockerRules('lockfile-without-npmrc.Dockerfile')).toEqual(['docker-install-order']);
  });

  it('SEC-TC-45: npm ci without --ignore-scripts in a Dockerfile fails', () => {
    expect(dockerRules('missing-ignore-scripts.Dockerfile')).toEqual(['install-flags']);
  });

  it('ADR-0023 am. I item 2: --omit=dev without --omit=optional fails', () => {
    expect(dockerRules('omit-dev-only.Dockerfile')).toEqual(['docker-omit-optional']);
  });

  it('ADR-0023 am. J item 6: npm rebuild in a Dockerfile fails (and so does re-enabling scripts)', () => {
    expect(dockerRules('npm-rebuild.Dockerfile')).toEqual(['install-flags', 'docker-npm-rebuild']);
  });

  it('D-ARCH-041 check-no-raw-prisma: a Dockerfile running the Prisma CLI directly fails', () => {
    expect(dockerRules('raw-prisma.Dockerfile')).toEqual(['raw-prisma']);
  });

  it('review M1: `npm clean-install` (alias) in a stage that never copied .npmrc fails docker-install-order', () => {
    expect(dockerRules('clean-install-without-npmrc.Dockerfile')).toEqual(['docker-install-order']);
  });

  it('review M1: `npm ic --ignore-scripts false` re-enables scripts in a Dockerfile and fails', () => {
    expect(dockerRules('ignore-scripts-bare-false.Dockerfile')).toEqual(['install-flags']);
  });

  it('review M1: an aliased install with --omit=dev only fails docker-omit-optional; npm rb fails docker-npm-rebuild', () => {
    const text = 'FROM node:24 AS deps\nCOPY package-lock.json .npmrc ./\nRUN npm cit --ignore-scripts --omit=dev\nRUN npm rb\n';
    expect(rules(checkDockerfile(text, 'x.Dockerfile'))).toEqual(['docker-omit-optional', 'docker-npm-rebuild']);
  });
});

describe('review M1: npm aliases and ignore-scripts overrides in every command-bearing file', () => {
  it.each([
    'npm clean-install',
    'npm ic',
    'npm cit',
    'npm it',
    'npm sit',
    'npm ins',
    'npm instal',
    'npm isnt',
    'npm isntall-clean',
    'npm install-cl',
    'npm cleanInstall',
    'npm add left-pad',
    'npm --prefix app ci',
  ])('a package.json script "%s" without --ignore-scripts fails', (command) => {
    expect(rules(checkPackageJson(JSON.stringify({ scripts: { setup: command } }), 'package.json'))).toEqual(['install-flags']);
  });

  it.each([
    'npm ci --ignore-scripts false',
    'npm ci --ignore-scripts=false',
    'npm ci --ignore-scripts=0',
    'npm ci --no-ignore-scripts',
    'npm ci --ig false',
    'npm ci -ig false',
    'npm ci --ignore-scripts=true --ignore-scripts false',
    'npm_config_ignore_scripts=false npm ci --ignore-scripts',
    'npm rebuild --ignore-scripts false',
    'npm config set ignore-scripts false',
    'echo "ignore-scripts=false" >> .npmrc',
    'export NPM_CONFIG_IGNORE_SCRIPTS=false',
  ])('a workflow step "%s" fails', (command) => {
    expect(rules(checkCommandText(`      - run: ${command}\n`, 'w.yml'))).toEqual(['install-flags']);
  });

  it('npm run ci and npm exec --no -- are not installs', () => {
    expect(checkCommandText('      - run: npm run ci && npm exec --no -- commitlint\n', 'w.yml')).toEqual([]);
  });

  it('review n2: skipped fixture directories are anchored; a `fixtures/` folder elsewhere is scanned', () => {
    const root = tempRepo({
      '.npmrc': rootNpmrc,
      'apps/api/fixtures/package.json': JSON.stringify({ scripts: { setup: 'npm ic' } }),
      'tools/ci/fixtures/package.json': JSON.stringify({ scripts: { setup: 'npm ic' } }),
    });
    expect(checkInstallFlags(root).findings.map((f) => f.location)).toEqual(['apps/api/fixtures/package.json scripts.setup']);
  });
});

describe('workflows, compose files and package.json scripts', () => {
  it('SEC-TC-45: npm ci without --ignore-scripts in a workflow fails; with it passes', () => {
    expect(rules(checkCommandText('steps:\n  - run: npm ci\n', 'w.yml'))).toEqual(['install-flags']);
    expect(rules(checkCommandText('steps:\n  - run: npm ci --ignore-scripts\n', 'w.yml'))).toEqual([]);
  });

  it('SEC-TC-64 check-no-npx: npx in a package.json script fails; npm exec --no -- passes', () => {
    expect(rules(checkPackageJson(JSON.stringify({ scripts: { gen: 'npx openapi-typescript x' } }), 'package.json'))).toEqual(['npx']);
    expect(rules(checkPackageJson(JSON.stringify({ scripts: { gen: 'npm exec --no -- openapi-typescript x' } }), 'package.json'))).toEqual(
      [],
    );
  });

  it.each([
    'npm -w apps/web -w apps/admin exec --no -- react-router typegen',
    'npm -w apps/api exec --no -- tsc -b',
    'npm exec --no -- prettier --check .',
  ])('[TASK-015] canonical npm exec form is accepted: %s', (command) => {
    expect(nonCanonicalNpmExec(command)).toBe(false);
    expect(rules(checkPackageJson(JSON.stringify({ scripts: { s: command } }), 'package.json'))).toEqual([]);
  });

  it.each([
    'npm --yes exec --no -- foo',
    'npm --package=evil exec --no -- foo',
    'npm -w apps/web exec --yes -- foo',
    'npm -w apps/web exec -- foo',
    'npm -w apps/web exec foo',
    'npm --workspace apps/web exec --no -- foo',
    'npm -w --yes exec --no -- foo',
    'npm -ws exec --no -- foo',
    'npm -w apps/web x --no -- foo',
    'npm -w apps/web exec --no --package=evil -- foo',
    'npm -w apps/web exec --no -- --yes',
    'npm -w apps/web exec --no --',
    'npm --prefix x exe --no -- foo',
  ])('[TASK-015] options around npm exec escape no more: %s is an npx finding', (command) => {
    expect(nonCanonicalNpmExec(command)).toBe(true);
    expect(rules(checkPackageJson(JSON.stringify({ scripts: { s: command } }), 'package.json'))).toEqual(['npx']);
  });

  it.each([
    ['package.json script "prisma generate"', () => checkPackageJson(JSON.stringify({ scripts: { gen: 'prisma generate' } }), 'p.json')],
    [
      'package.json script "npm exec --no -- prisma migrate deploy"',
      () => checkPackageJson(JSON.stringify({ scripts: { m: 'npm exec --no -- prisma migrate deploy' } }), 'p.json'),
    ],
    [
      'workflow step "node_modules/.bin/prisma validate"',
      () => checkCommandText('      - run: node_modules/.bin/prisma validate\n', 'w.yml'),
    ],
    [
      'compose command array ["prisma", "migrate", "deploy"]',
      () => checkCommandText('    command: ["prisma", "migrate", "deploy"]\n', 'compose.yaml'),
    ],
  ])('D-ARCH-041 check-no-raw-prisma: %s fails', (_title, check) => {
    expect(rules(check())).toContain('raw-prisma');
  });

  it('D-ARCH-041: the wrapper "node tools/deps/prisma-cli.mjs migrate deploy" passes', () => {
    expect(checkPackageJson(JSON.stringify({ scripts: { m: 'node tools/deps/prisma-cli.mjs migrate deploy' } }), 'p.json')).toEqual([]);
  });
});

describe('_prisma_migrations writes (PR-0005 n8)', () => {
  const statement = ['INSERT', 'INTO', '"_prisma_migrations"', '(id) VALUES ($1)'].join(' ');

  it('n8: a write outside prisma/tests/** fails', () => {
    expect(rules(checkMigrationsWrite(`await client.query('${statement}');\n`, 'tools/db/reset.ts'))).toEqual(['prisma-migrations-write']);
  });

  it('n8: the test harness under prisma/tests/** is allowed; reads are allowed anywhere', () => {
    expect(checkMigrationsWrite(`await client.query('${statement}');\n`, 'prisma/tests/harness/postgres.ts')).toEqual([]);
    expect(checkMigrationsWrite(`SELECT * FROM "_prisma_migrations"`, 'tools/db/status.ts')).toEqual([]);
  });
});
