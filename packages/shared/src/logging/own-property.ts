// Guarded reads of values the logger does not trust (US-007 AT-US-007-03, US-008; TASK-010). Logged values and thrown
// values may be Proxies whose traps throw or objects with throwing getters, so every read is an own-data-property read
// inside a guard: user getters are never invoked and a throwing trap degrades to "absent". Same idea as
// apps/api/src/platform/errors/classify.ts (packages never import from apps).

/** True for objects and functions (the values that can carry properties). */
export function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/** Value of an own data property; undefined for accessors, missing keys and values whose inspection throws. */
export function ownDataProperty(value: unknown, key: string): unknown {
  if (!isObjectLike(value)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Own data property when it is a string; undefined otherwise. */
export function ownString(value: unknown, key: string): string | undefined {
  const property = ownDataProperty(value, key);
  return typeof property === 'string' ? property : undefined;
}

/** True when `key` is an own property (data or accessor) of `value`; false when the inspection throws. */
export function hasOwnKey(value: unknown, key: string): boolean {
  if (!isObjectLike(value)) return false;
  try {
    return Object.getOwnPropertyDescriptor(value, key) !== undefined;
  } catch {
    return false;
  }
}

/** Data property `key` of the nearest prototype of `value` that defines one (bounded walk); undefined otherwise. */
export function inheritedDataProperty(value: unknown, key: string, maxDepth = 4): unknown {
  let current: unknown = value;
  for (let level = 0; level < maxDepth && isObjectLike(current); level += 1) {
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return undefined;
    }
    const property = ownDataProperty(current, key);
    if (property !== undefined) return property;
  }
  return undefined;
}

/** `constructor.name` of the prototype of `value`, read without invoking getters; undefined when unavailable. */
export function constructorName(value: unknown): string | undefined {
  if (!isObjectLike(value)) return undefined;
  try {
    const constructor = ownDataProperty(Object.getPrototypeOf(value), 'constructor');
    const name = ownDataProperty(constructor, 'name');
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}
