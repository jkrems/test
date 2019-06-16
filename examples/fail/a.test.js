'use strict';

const { expect } = require('chai');

if (typeof it === 'undefined') {
  global.it = require('../../lib/test-lang');
}
if (typeof describe === 'undefined') {
  global.describe = (name, fn) => fn();
}

describe('failing a', () => {
  it('hello is 42', () => {
    const actual = 'hello';
    const expected = 21;

    console.error('throw error');
    throw new Error('huh?');

    // Find statement (or arrow body?) containing the call frame, then print:
    // 1. Any non-literal expression, with object and array literals counting as literals
    // 2. That is passed as a function argument
    // 3. Also, maybe: Current values from the scope, maybe only if they appear..?
    //    A meaningful limit may be "only up to the next function scope"..?
    expect(actual).to.eq(new Map([['answer', `The answer is ${expected * 2}`]]));
    /*     |             |                   |                |
           |             |                   |                42
           |             |                   "The answer is 42"
           | "hello"     Map { "answer" => "The answer is 42" }
     */
    expect(actual).to.eq(expected * 2);
  });

  it('read on undefined', () => {
    const actual = module;
    const expected = 21;

    expect(actual).property('foo').property('bar').to.eq(expected * 2);
  });
});
