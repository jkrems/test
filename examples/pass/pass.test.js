'use strict';

const { expect } = require('chai');

describe('passing', () => {
  it('is 42', () => {
    const actual = 42;
    const expected = 21;

    expect(actual).to.eq(expected * 2);
  });

  it('reads a property', () => {
    const actual = module;
    const expected = __filename;

    expect(actual).property('filename').eq(expected);
  });
});
