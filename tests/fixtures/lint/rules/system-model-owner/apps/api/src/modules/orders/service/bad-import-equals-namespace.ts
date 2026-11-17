// The namespace is the import-equals target (its own no-namespace finding is expected).
namespace Shapes {
  export const kind = 'order';
}

import Kind = Shapes.kind;

/** PR44-SEC-11 (a): a read of an `import X = NS.y` binding must not crash the lint run (no loader, no module load). */
export const label = (): string => Kind;
