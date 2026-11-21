// PR080-SEC-02 (TASK-080): a destructured declare binds Date without an identifier id; the emitted code calls the real
// clock.
declare const { Date }: { Date: DateConstructor };

export const stamp = (): number => Date.now();
