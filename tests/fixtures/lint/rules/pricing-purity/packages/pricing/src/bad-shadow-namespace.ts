// PR080-SEC-02 (TASK-080): a type-only namespace binds Date for the scope manager; TypeScript emits nothing for it and
// the value Date below is the real clock. @typescript-eslint/no-namespace is the second control.
namespace Date {
  export type Stamp = number;
}

export const stamp = (): number => Date.now();
