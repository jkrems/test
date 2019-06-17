'use strict';

const { reporters: { Base }, Runner } = require('mocha');

const ExceptionContextCapture = require('../lib/exception-context-capture');


const {
  EVENT_TEST_PASS,
  EVENT_TEST_FAIL,
  EVENT_SUITE_BEGIN,
  EVENT_SUITE_END,
  EVENT_TEST_PENDING,
} = Runner.constants;

class MochaReporter extends Base {
  /**
   * @param {Runner} runner
   * @param {import('mocha').MochaOptions} options
   */
  constructor(runner, options) {
    super(runner);

    this._runner = runner;
    this._options = options;

    this.capture = new ExceptionContextCapture();

    runner.suite.beforeAll(() => this.capture.attach());
    runner.suite.afterAll(() => this.capture.detatch());

    runner.on(EVENT_TEST_FAIL, (rootSuite) => {
      const context = this.capture.getContextForError(rootSuite.err);
      console.log(context);
    });
  }
}
module.exports = MochaReporter;
