'use strict';

const path = require('path');

const kleur = require('kleur');
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

    const projectDir = process.cwd();

    this.capture = new ExceptionContextCapture();

    runner.suite.beforeAll(() => this.capture.attach());
    runner.suite.afterAll(() => this.capture.detatch());

    runner.on(EVENT_TEST_FAIL, (rootSuite) => {
      const context = this.capture.getContextForError(rootSuite.err);
      const relativeFilename = path.relative(projectDir, rootSuite.file);
      console.log(`\
${kleur.bgRed().bold().white(' FAIL ')} \
${kleur.bold(rootSuite.fullTitle())} \
${kleur.gray(`(${relativeFilename})`)}

${context}\
`);
    });

    runner.on(EVENT_TEST_PASS, (rootSuite) => {
      const relativeFilename = path.relative(projectDir, rootSuite.file);
      console.log(`\
${kleur.bgGreen().bold().white(' PASS ')} \
${kleur.bold(rootSuite.fullTitle())} \
${kleur.gray(`(${relativeFilename})`)}\
`);
    });
  }
}
module.exports = MochaReporter;
