'use strict';

const { Session } = require('inspector');
const { fileURLToPath } = require('url');

const { expect } = require('chai');

function getDomain(session, name) {
  return new Proxy({}, {
    get(target, key /* , receiver */) {
      if (typeof key === 'string') {
        return (params) => {
          return new Promise((resolve, reject) => {
            const method = `${name}.${key}`;
            session.post(method, params, (err, value) => {
              if (err) reject(Object.assign(err, { method, params }));
              else resolve(value);
            });
          });
        };
      }
      return target[key];
    }
  });
}

function reportError(e) {
  console.log('failed', e)
}

async function test(name, fn) {
  const session = new Session();
  session.connect();

  const assertErrorRegex = '^.+\\/node_modules\\/assertion-error\\/index\\.js$';

  const urlFromScriptId = new Map();
  session.on('Debugger.scriptParsed', ({ params: { scriptId, url } }) => {
    urlFromScriptId.set(scriptId, url);
  });

  session.on('Debugger.paused', ({ params }) => {
    // TODO: Potentially write some meta info on a failed assertion.
    // Out of process, we could gather the state of the various frames/scopes.
    // From within the process, we can't really do much since we can't inspect
    // the RemoteObjects that contain the scope state.
    console.log('Paused!', params.callFrames.find(callFrame => {
      return callFrame.url.endsWith('/a.test.js');
    }));
  });

  const Debugger = getDomain(session, 'Debugger');
  const Runtime = getDomain(session, 'Runtime');

  await Debugger.enable();
  await Runtime.enable();

  const uniqDebugId = `$$$_test_debug_assertion_error_$$$`;
  await Runtime.evaluate({
    expression: `void (global[${JSON.stringify(uniqDebugId)}] = debug)`,
    includeCommandLineAPI: true,
  });

  const assertErrorBrk = await Debugger.setBreakpointByUrl({
    urlRegex: assertErrorRegex,
    lineNumber: 0,
    condition: `(${
      (dbgId) => {
        if (global[dbgId]) {
          const dbg = global[dbgId];
          dbg(AssertionError);
        }
        return false;
      }})(${JSON.stringify(uniqDebugId)})`,
  });
  if (assertErrorBrk.locations.length) {
    for (const { scriptId } of assertErrorBrk.locations) {
      const scriptUrl = urlFromScriptId.get(scriptId);
      if (!scriptUrl) continue;
      const scriptPath = fileURLToPath(scriptUrl);
      await Runtime.evaluate({
        expression: `debug(require(${JSON.stringify(scriptPath)}))`,
        includeCommandLineAPI: true,
      });
    }
  }

  // get coverage
  const Profiler = getDomain(session, 'Profiler');
  await Profiler.enable();
  await Profiler.startPreciseCoverage({ detailed: true, callCount: false });

  try {
    fn();
  } catch (e) {
    reportError(e);
  } finally {
    const { result } = await Profiler.takePreciseCoverage();
    console.log('a.test.js', ...result.find(({ url }) => url.endsWith('a.test.js')).functions);
  }
}

test('hello is 42', () => {
  const actual = 'hello';
  const expected = 42;

  expect(actual).to.eq(expected);
});
