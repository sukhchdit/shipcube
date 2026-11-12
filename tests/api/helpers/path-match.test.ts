// Unit tests for OpenAPI path-template matching (US-034, REQ-API-004, api/README.md §16 item 2).
import { describe, expect, it } from '@jest/globals';

import { compilePathTemplate, matchAll, matchPath, MAX_MATCH_PATH_LENGTH, requestPathOf } from './path-match.js';

const templates = [
  '/api/v1/orgs/{orgId}',
  '/api/v1/orgs/me',
  '/api/v1/orgs/{orgId}/members/{memberId}',
  '/api/v1/{a}/me',
  '/health/live',
].map((template) => compilePathTemplate(template, template));

describe('path template matching', () => {
  it('a parameter matches one non-empty segment without a slash', () => {
    expect(matchPath(templates, '/api/v1/orgs/0193a5b2')?.value).toBe('/api/v1/orgs/{orgId}');
    expect(matchPath(templates, '/api/v1/orgs/')).toBeUndefined();
    expect(matchPath(templates, '/api/v1/orgs/a/b')).toBeUndefined();
    expect(matchPath(templates, '/api/v1/orgs/o1/members/m1')?.value).toBe('/api/v1/orgs/{orgId}/members/{memberId}');
  });

  it('static segments win over parameters, first difference decides', () => {
    expect(matchAll(templates, '/api/v1/orgs/me').map((t) => t.value)).toEqual([
      '/api/v1/orgs/me',
      '/api/v1/orgs/{orgId}',
      '/api/v1/{a}/me',
    ]);
  });

  it('ignores the query string and fragment, and refuses over-long paths', () => {
    expect(requestPathOf('/health/live?probe=1#x')).toBe('/health/live');
    expect(matchPath(templates, '/health/live?token=abc')?.value).toBe('/health/live');
    expect(matchPath(templates, `/api/v1/orgs/${'a'.repeat(MAX_MATCH_PATH_LENGTH)}`)).toBeUndefined();
  });

  it('trailing slashes and case are significant', () => {
    expect(matchPath(templates, '/health/live/')).toBeUndefined();
    expect(matchPath(templates, '/Health/live')).toBeUndefined();
  });
});
