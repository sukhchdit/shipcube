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
    expect(isClosedObjectSchema(Joi.object({}).unknown(false))).toBe(true);
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
