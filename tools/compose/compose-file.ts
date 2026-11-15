/**
 * Static reader for compose.yaml and the env files it names (TASK-014; platform.md §2.1-§2.3). compose.yaml is written
 * in the YAML subset of tools/ci/yaml-subset.mjs, so the lane A tests and the stack suite read it without a YAML
 * dependency. The merge mirrors Compose: `env_file` entries in order, then `environment` (which wins), with
 * `${NAME}`, `${NAME:-default}` and `$$` interpolated from the given host variables. Values are only ever compared by
 * the callers, never printed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isMap, parseYamlSubset } from '../ci/yaml-subset.mjs';
import { parseEnvFile } from '../config/env-file.js';

type YamlNode = string | YamlNode[] | { [key: string]: YamlNode };
export type YamlMap = { [key: string]: YamlNode };

export interface ComposeFile {
  readonly services: Readonly<Record<string, YamlMap>>;
  readonly volumes: readonly string[];
  readonly raw: YamlMap;
}

const asMap = (node: YamlNode | null | undefined): YamlMap => (isMap(node) ? node : {});

const asStrings = (node: YamlNode | null | undefined): string[] => {
  if (typeof node === 'string') return [node];
  return Array.isArray(node) ? node.filter((item): item is string => typeof item === 'string') : [];
};

/** Parses compose YAML text (throws YamlSubsetError on anything outside the subset). */
export function parseCompose(text: string): ComposeFile {
  const raw = asMap(parseYamlSubset(text).value);
  const services = Object.fromEntries(Object.entries(asMap(raw['services'])).map(([name, node]) => [name, asMap(node)]));
  return { services, volumes: Object.keys(asMap(raw['volumes'])), raw };
}

export function readCompose(root: string, file = 'compose.yaml'): ComposeFile {
  return parseCompose(readFileSync(join(root, file), 'utf8'));
}

/** `${NAME}`, `${NAME:-default}`, `${NAME-default}` and `$$`, as Compose interpolates them. */
export function interpolate(value: string, vars: Readonly<Record<string, string | undefined>>): string {
  return value.replace(
    /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}/g,
    (match, name: string | undefined, op, fallback: string | undefined) => {
      if (match === '$$') return '$';
      const current = vars[name ?? ''];
      if (op === ':-') return current === undefined || current === '' ? (fallback ?? '') : current;
      if (op === '-') return current === undefined ? (fallback ?? '') : current;
      return current ?? '';
    },
  );
}

export const envFilesOf = (service: YamlMap): string[] => asStrings(service['env_file']);

export const stringsOf = (service: YamlMap, key: string): string[] => asStrings(service[key]);

/** The `environment` mapping of a service as raw (uninterpolated) strings. */
export function environmentOf(service: YamlMap): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asMap(service['environment'])).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** Entries of one env file (relative to `root`). */
export function readEnvFile(root: string, file: string): ReadonlyMap<string, string> {
  return parseEnvFile(readFileSync(join(root, file), 'utf8')).entries;
}

/** The environment Compose gives the container of `name` (env files, then `environment`), host vars unset by default. */
export function serviceEnvironment(
  root: string,
  compose: ComposeFile,
  name: string,
  hostVars: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const service = compose.services[name];
  if (service === undefined) throw new Error(`compose service ${name} is not defined`);
  const merged: Record<string, string> = {};
  for (const file of envFilesOf(service)) for (const [key, value] of readEnvFile(root, file)) merged[key] = value;
  for (const [key, value] of Object.entries(environmentOf(service))) merged[key] = interpolate(value, hostVars);
  return merged;
}

/** Published port strings of a service, interpolated with the given host variables. */
export function publishedPorts(service: YamlMap, hostVars: Readonly<Record<string, string | undefined>> = {}): string[] {
  return asStrings(service['ports']).map((port) => interpolate(port, hostVars));
}

/** Every `image:` reference, by service, uninterpolated. */
export function imagesOf(compose: ComposeFile): Record<string, string> {
  return Object.fromEntries(
    Object.entries(compose.services).flatMap(([name, service]) => (typeof service['image'] === 'string' ? [[name, service['image']]] : [])),
  );
}

/** `FROM` references of every inline Dockerfile (`build.dockerfile_inline`), by service. */
export function inlineDockerfileBases(compose: ComposeFile): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(compose.services).flatMap(([name, service]) => {
      const inline = asMap(service['build'])['dockerfile_inline'];
      if (typeof inline !== 'string') return [];
      return [[name, [...inline.matchAll(/^FROM\s+(\S+)/gim)].map((match) => match[1] ?? '')]];
    }),
  );
}

/** `depends_on` of a service as name -> condition. */
export function dependsOn(service: YamlMap): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asMap(service['depends_on'])).map(([name, node]) => {
      const condition = asMap(node)['condition'];
      return [name, typeof condition === 'string' ? condition : ''];
    }),
  );
}

/** `true` when the service is built locally (it carries a `build` section). */
export const isBuilt = (service: YamlMap): boolean => service['build'] !== undefined;
