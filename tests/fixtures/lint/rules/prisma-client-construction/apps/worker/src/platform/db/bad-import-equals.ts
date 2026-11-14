import generated = require('@platform/prisma/client');

/** PR44-SEC-11 (a), fail closed: `import x = require('<literal>')` is a require-style load of the generated client. */
export const client = generated;
