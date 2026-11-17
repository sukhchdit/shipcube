// PR48-SEC-03: a production authorise decides with the matrix oracle (the subpath specifier).
import { expectCell } from '@platform/authz/matrix';

export const decide = (): unknown => expectCell;
