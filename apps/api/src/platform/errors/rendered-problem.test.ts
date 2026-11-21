// Problem documents rendered once (TASK-040; ADR-0014 amendment 6, D-ARCH-195).
import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';

import { buildProblem } from './problem.js';
import { isRenderedProblem, RenderedProblemError, renderProblem, storedProblemCode } from './rendered-problem.js';

describe('[D-ARCH-195] rendered problems', () => {
  it('renderProblem classifies and builds exactly what buildProblem gives for the code and the client-safe fields', () => {
    const thrown = new AppError('CONFLICT', { detail: 'Already booked.' });
    const rendered = renderProblem(thrown, { correlationId: 'c-1', url: '/api/v1/x?y=1' });
    expect(rendered.code).toBe('CONFLICT');
    expect(rendered.problem).toEqual(buildProblem({ code: 'CONFLICT', correlationId: 'c-1', url: '/api/v1/x', detail: 'Already booked.' }));
    expect(renderProblem(new Error('x'), { correlationId: 'c', url: '/', typeBase: 'https://t/' }).problem).toMatchObject({
      code: 'INTERNAL_ERROR',
      type: 'https://t/INTERNAL_ERROR',
    });
  });

  it('only a constructed RenderedProblemError is recognised; its status comes from the catalogue', () => {
    const error = new RenderedProblemError('CONFLICT', '{"code":"CONFLICT"}', { replayed: true });
    expect(isRenderedProblem(error)).toBe(true);
    expect(error).toMatchObject({ status: 409, replayed: true, body: '{"code":"CONFLICT"}' });
    expect(isRenderedProblem({ ...error })).toBe(false);
    expect(isRenderedProblem(null)).toBe(false);
  });

  it('storedProblemCode accepts a catalogue code whose status matches, nothing else', () => {
    expect(storedProblemCode({ code: 'CONFLICT' }, 409)).toBe('CONFLICT');
    expect(storedProblemCode({ code: 'CONFLICT' }, 422)).toBeUndefined();
    expect(storedProblemCode({ code: 'NOPE' }, 409)).toBeUndefined();
    expect(storedProblemCode('CONFLICT', 409)).toBeUndefined();
    expect(storedProblemCode(null, 409)).toBeUndefined();
  });
});
