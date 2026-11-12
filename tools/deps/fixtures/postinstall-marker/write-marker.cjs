// Writes `postinstall-marker.txt` into the directory npm was invoked from (INIT_CWD).
// The marker existing after an install proves lifecycle scripts ran.
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

writeFileSync(join(process.env.INIT_CWD || process.cwd(), 'postinstall-marker.txt'), 'postinstall ran\n');
