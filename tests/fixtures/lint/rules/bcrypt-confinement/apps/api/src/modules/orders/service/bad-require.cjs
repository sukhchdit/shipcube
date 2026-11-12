const bcrypt = require('bcrypt');

module.exports = { hash: (secret) => bcrypt.hash(secret, 12) };
