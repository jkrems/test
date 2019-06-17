'use strict';

const { expect } = require('chai');

describe('failing a', () => {
  it('hello is 42', () => {
    const actual = 'hello';
    const expected = 21;

    expect(actual).to.eq(expected * 2);
  });

  it('read on undefined', () => {
    const actual = module;
    const expected = 21;

    expect(actual).property('foo').property('bar').to.eq(expected * 2);
  });
});
