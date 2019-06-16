#!/usr/bin/env node

'use strict';

const path = require('path');

if (typeof it === 'undefined') {
  global.it = require('./lib/test-lang');
}
if (typeof describe === 'undefined') {
  global.describe = (name, fn) => fn();
}

require(path.resolve(process.argv[2]));
