'use strict';

const { reporters: { Base } } = require('mocha');

class MochaReporter extends Base {
  constructor(runner, options) {
    super(runner);

    console.log('start reporter');
    this._runner = runner;
    this._options = options;

    // runner.on()
  }
}
module.exports = MochaReporter;
