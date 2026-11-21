import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@jest/globals';
import Joi from 'joi';

import {
  EVENT_CATALOGUE,
  EVENT_MODULES,
  EVENT_TYPE_PATTERN,
  identifierPayload,
  isClosedObjectSchema,
  mergeEvents,
  validateEventPayload,
} from './index.js';

const ID = '0193a5b2-7c1e-7d4a-9f3b-000000000f01';
const booked = { aggregateType: 'shipment', payload: Joi.object({ shipment_id: Joi.string().guid().required() }) };

describe('domain event catalogue (ADR-0004 item 5; TASK-043)', () => {
  it('aggregates every events/<module>.ts file, and nothing else', () => {
    const helpers = new Set(['index.ts', 'event-definition.ts']);
    const files = readdirSync(dirname(fileURLToPath(import.meta.url)))
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !helpers.has(file))
      .map((file) => file.replace(/\.ts$/, ''))
      .sort();
    expect(Object.keys(EVENT_MODULES).sort()).toEqual(files);
    expect(Object.keys(EVENT_CATALOGUE).every((type) => EVENT_TYPE_PATTERN.test(type))).toBe(true);
  });

  it('merges module files and refuses a duplicate type, a type outside <area>.<fact> and a bad aggregate type', () => {
    expect(Object.keys(mergeEvents({ shipments: { 'shipment.booked': booked } }))).toEqual(['shipment.booked']);
    expect(() => mergeEvents({ a: { 'shipment.booked': booked }, b: { 'shipment.booked': booked } })).toThrow(
      'Event type shipment.booked is declared by both a and b',
    );
    expect(() => mergeEvents({ a: { 'Shipment.Booked': booked } })).toThrow('is not <area>.<fact>');
    expect(() => mergeEvents({ a: { 'shipment.booked': { ...booked, aggregateType: 'Ship ment' } } })).toThrow('lower-case identifier');
  });

  it('[m5] refuses a payload schema that is open (.unknown(true)) or not a Joi object', () => {
    const open = { aggregateType: 'shipment', payload: Joi.object({ shipment_id: Joi.string() }).unknown(true) };
    expect(() => mergeEvents({ a: { 'shipment.booked': open } })).toThrow('must be a closed Joi object');
    const notObject = { aggregateType: 'shipment', payload: Joi.string() as unknown as Joi.ObjectSchema };
    expect(() => mergeEvents({ a: { 'shipment.booked': notObject } })).toThrow('must be a closed Joi object');
    expect(isClosedObjectSchema({})).toBe(false);
  });

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const id = Joi.string().pattern(UUID).required();

  it.each([
    ['Joi.object() (no keys: Joi then allows any key)', Joi.object()],
    ['Joi.object().keys() (no argument)', Joi.object().keys()],
    ['a pattern of keys', Joi.object({}).pattern(/./, Joi.any())],
    ['a nested object with unknown()', Joi.object({ meta: Joi.object().unknown() })],
    ['a nested object without keys', Joi.object({ meta: Joi.object() })],
    ['a nested any', Joi.object({ meta: Joi.any() })],
    ['a nested allowUnknown preference', Joi.object({ meta: Joi.object({ id }).prefs({ allowUnknown: true }) })],
    ['nested alternatives', Joi.object({ meta: Joi.alternatives().try(Joi.object().unknown(), Joi.string()) })],
    ['an array without items', Joi.object({ list: Joi.array() })],
    ['a free string value', Joi.object({ shipmentId: Joi.string() })],
    ['a top-level unknown(true) (control)', Joi.object({ id }).unknown(true)],
    ['a top-level allowUnknown preference (control)', Joi.object({ id }).options({ allowUnknown: true })],
  ])('[PR043-SEC-01] mergeEvents refuses %s', (_label, schema) => {
    expect(isClosedObjectSchema(schema)).toBe(false);
    expect(() => mergeEvents({ a: { 'shipment.booked': { aggregateType: 'shipment', payload: schema } } })).toThrow(
      'must be a closed Joi object',
    );
  });

  it('[PR043-SEC-01] mergeEvents accepts identifier, locale-list, bounded-string, nested closed and closed-array payloads', () => {
    const accepted = [
      identifierPayload('a', 'b'),
      Joi.object({ shipment_id: id, locale: Joi.string().valid('en', 'es', 'fr').required() }),
      Joi.object({
        token_enc: Joi.string().base64({ paddingRequired: true }),
        token_enc_key_id: Joi.string().pattern(/^[a-z0-9-]{1,40}$/),
      }),
      Joi.object({
        order: Joi.string().guid(),
        at: Joi.string().isoDate(),
        blob_enc: Joi.string().base64(),
        n: Joi.number(),
        ok: Joi.boolean(),
      }),
      Joi.object({ meta: Joi.object({ id }), ids: Joi.array().items(id), when: Joi.date() }),
    ];
    for (const payload of accepted) {
      expect(isClosedObjectSchema(payload)).toBe(true);
      expect(Object.keys(mergeEvents({ a: { 'shipment.booked': { aggregateType: 'shipment', payload } } }))).toEqual(['shipment.booked']);
    }
  });

  const ADDRESS = 'p@example.com';
  const catalogued = (payload: Joi.ObjectSchema) => ({ aggregateType: 'shipment', payload });

  // [label, schema, a payload the schema admits that stores an address or free text (undefined: no sync demonstration)].
  // The demonstration keeps each row non-vacuous: without the walk, the shape really stores the value.
  it.each<[string, Joi.ObjectSchema, Record<string, unknown> | undefined]>([
    [
      'an object-level when that switches to an open object',
      Joi.object({ kind: Joi.string().valid('x') }).when(Joi.object({ kind: Joi.valid('x') }).unknown(), {
        then: Joi.object({ kind: Joi.string().valid('x'), email: Joi.string() }),
      }),
      { kind: 'x', email: ADDRESS },
    ],
    ['a key-level when', Joi.object({ id: Joi.string().guid().when('b', { is: 1, then: Joi.forbidden() }), b: Joi.number() }), undefined],
    ['ordered array items', Joi.object({ list: Joi.array().items(Joi.number()).ordered(Joi.any()) }), { list: [ADDRESS] }],
    [
      'a custom rule that replaces the value',
      Joi.object({
        id: Joi.string()
          .guid()
          .custom(() => ADDRESS),
      }),
      { id: ID },
    ],
    ['an inverted pattern', Joi.object({ code: Joi.string().pattern(/^[A-Z]{3}$/, { invert: true }) }), { code: ADDRESS }],
    ['a default function', Joi.object({ n: Joi.number().default(() => ADDRESS) }), {}],
    ['a default value', Joi.object({ id: Joi.string().guid().default(ADDRESS) }), {}],
    ['a failover value', Joi.object({ id: Joi.string().guid().failover(ADDRESS) }), { id: 'not-a-guid' }],
    ['an external rule', Joi.object({ n: Joi.number().external(() => ADDRESS) }), undefined],
    ['a match-anything pattern /^.*$/', Joi.object({ code: Joi.string().pattern(/^.*$/) }), { code: ADDRESS }],
    ['a match-anything pattern /./', Joi.object({ code: Joi.string().pattern(/./) }), { code: ADDRESS }],
    ['base64 under a key that is not *_enc', Joi.object({ blob: Joi.string().base64() }), { blob: btoa(ADDRESS) }],
    ['base64 beside guid under a key that is not *_enc', Joi.object({ token_encx: Joi.string().base64().guid() }), undefined],
    ['base64 array items under a key that is not *_enc', Joi.object({ list: Joi.array().items(Joi.string().base64()) }), undefined],
  ])('[PR043-SEC-08] mergeEvents refuses %s', (_label, schema, admitted) => {
    if (admitted !== undefined) expect(validateEventPayload(catalogued(schema), admitted).ok).toBe(true);
    expect(isClosedObjectSchema(schema)).toBe(false);
    expect(() => mergeEvents({ a: { 'shipment.booked': catalogued(schema) } })).toThrow('must be a closed Joi object');
  });

  // Mutant-style negatives for the probe set: each regex refuses three probes and admits exactly the fourth, so
  // dropping any one probe from the set turns exactly one row red.
  it.each([
    ['an e-mail address', /^[a-z@.]{1,40}$/, ADDRESS],
    ['text with a space', /^[a-z ]{1,40}$/, 'free text'],
    ['the empty string', /^[a-z]{0,8}$/, ''],
    ['a 257-letter string', /^[a-z]+$/, 'a'.repeat(257)],
  ])('[PR043-SEC-08] a pattern that admits only %s counts as open', (_label, regex, probe) => {
    const others = [ADDRESS, 'free text', '', 'a'.repeat(257)].filter((value) => value !== probe);
    expect(regex.test(probe)).toBe(true);
    expect(others.some((value) => regex.test(value))).toBe(false);
    expect(isClosedObjectSchema(Joi.object({ code: Joi.string().pattern(regex) }))).toBe(false);
    expect(isClosedObjectSchema(Joi.object({ list: Joi.array().items(Joi.string().pattern(regex)) }))).toBe(false);
  });

  it('[PR043-SEC-08] accepts the controls: identifiers, a locale list, *_enc ciphertext and probe-refusing patterns', () => {
    const accepted = [
      identifierPayload('a', 'b'),
      Joi.object({ locale: Joi.string().valid('en', 'es', 'fr').required() }),
      Joi.object({ token_enc: Joi.string().base64({ paddingRequired: true }), tokens_enc: Joi.array().items(Joi.string().base64()) }),
      Joi.object({ code: Joi.string().pattern(/^[A-Z]{3}$/i), key_id: Joi.string().pattern(/^[a-z0-9-]{1,40}$/, 'key id') }),
      Joi.object({ id: Joi.string().guid().empty(''), n: Joi.number().optional(), ok: Joi.boolean().required() }),
    ];
    for (const payload of accepted) expect(isClosedObjectSchema(payload)).toBe(true);
  });

  it('validates a payload closed and without conversion; issues name paths and rules, never values', () => {
    expect(validateEventPayload(booked, { shipment_id: ID })).toEqual({ ok: true, payload: { shipment_id: ID } });
    const refused = validateEventPayload(booked, { shipment_id: 'secret-value', email: 'a@b.c' });
    expect(refused).toEqual({ ok: false, issues: ['shipment_id: string.guid', 'email: object.unknown'] });
    expect(JSON.stringify(refused)).not.toMatch(/secret-value|a@b\.c/);
    expect(validateEventPayload(booked, null)).toMatchObject({ ok: false });
  });

  it('identifierPayload: a closed schema of required lower-case UUID keys', () => {
    const ids = { aggregateType: 'shipment', payload: identifierPayload('shipment_id', 'order_id') };
    expect(validateEventPayload(ids, { shipment_id: ID, order_id: ID }).ok).toBe(true);
    expect(validateEventPayload(ids, { shipment_id: ID })).toEqual({ ok: false, issues: ['order_id: any.required'] });
    expect(validateEventPayload(ids, { shipment_id: ID.toUpperCase(), order_id: ID }).ok).toBe(false);
    expect(validateEventPayload(ids, { shipment_id: ID, order_id: ID, extra: 1 }).ok).toBe(false);
  });
});
