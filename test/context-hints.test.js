'use strict';

const { expect } = require('chai');

const ExceptionContextCapture = require('../lib/exception-context-capture');

describe('context hints', () => {
  let capture = null;
  before(() => {
    capture = new ExceptionContextCapture();
    capture.attach();
  });
  after(() => {
    if (capture !== null) capture.detatch();
    capture = null;
  });

  // two options: capture details on throw or capture for exception types
  it('captures details on thrown exceptions', async () => {
    const { result, error, context } = await capture.fromAsyncCall(() => {










































































      const a = new Map([['x', 42], ['foo', 'bar']]);
      const b = [2, 3];
      const c = new Date('2019-06-16T04:47:08.240Z');
      const someLongerIdentifier = /x/;
      a.set('y', Date.now())['g' < b](
        someLongerIdentifier, c
      );
    });
    expect(result).eq(null);
    // console.log({ error, context });
  });

  it('returns null if there is no error', async () => {
    const { result, error, context } = await capture.fromAsyncCall(() => {
      return 42;
    });
    expect(error).eq(null);
    expect(context).eq(null);
    expect(result).eq(42);
  });
});
