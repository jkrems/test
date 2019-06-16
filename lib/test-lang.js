'use strict';

const { Session, open } = require('inspector');
// const { fileURLToPath } = require('url');

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

  // const assertErrorRegex = '^.+\\/node_modules\\/assertion-error\\/index\\.js$';

  const urlFromScriptId = new Map();
  session.on('Debugger.scriptParsed', ({ params: { scriptId, url } }) => {
    urlFromScriptId.set(scriptId, url);
  });

  session.on('Debugger.paused', ({ params }) => {
    // TODO: ignore paused states we didn't trigger
    console.log('break on %j', params.reason, /* error */ params.data);

    if (params.data && params.data.className === 'AssertionError') {
      session.post('Debugger.resume');
      return;
    }

    open(undefined, undefined, true);

    // find frame in user code / calling the assertion
    // in *theory* we would know what the test file is since we are the test runner.
    const aTestFrame = params.callFrames.find(callFrame => {
      return callFrame.url.endsWith('/a.test.js');
    });
    console.log('Paused!', aTestFrame);

    // // aTestFrame.location: { scriptId: '52', lineNumber: 124, columnNumber: 20 }
    // // get source
    // session.post('Debugger.getScriptSource', {
    //   scriptId: aTestFrame.location.scriptId,
    // }, (err, { scriptSource }) => {
    //   console.log(scriptSource);
    // });

    const localScopes = aTestFrame.scopeChain.filter(scope => scope.type !== 'global');
    console.table(localScopes);

    session.post('Runtime.callFunctionOn', {
      objectId: aTestFrame.scopeChain[0].object.objectId,
      functionDeclaration: (function getScopeState() {
        return Object.entries(this).map(([name, value]) => {
          return { name, preview: `${value}` };
        });
      }).toString(),
      returnByValue: true,
    }, (err, data) => {
      if (err) console.log(err);
      console.table(data.result.value);
      session.post('Debugger.resume', (...args) => {
        console.log('resumed', args);
      });
    });
  });

  const Debugger = getDomain(session, 'Debugger');
  const Runtime = getDomain(session, 'Runtime');

  await Debugger.enable();
  await Runtime.enable();

  await Debugger.setPauseOnExceptions({ state: 'all' });

  // const uniqDebugId = `$$$_test_debug_assertion_error_$$$`;
  // await Runtime.evaluate({
  //   expression: `void (global[${JSON.stringify(uniqDebugId)}] = debug)`,
  //   includeCommandLineAPI: true,
  // });

  // const assertErrorBrk = await Debugger.setBreakpointByUrl({
  //   urlRegex: assertErrorRegex,
  //   lineNumber: 0,
  //   condition: `(${
  //     (dbgId) => {
  //       if (global[dbgId]) {
  //         const dbg = global[dbgId];
  //         dbg(AssertionError);
  //       }
  //       return false;
  //     }})(${JSON.stringify(uniqDebugId)})`,
  // });
  // if (assertErrorBrk.locations.length) {
  //   for (const { scriptId } of assertErrorBrk.locations) {
  //     const scriptUrl = urlFromScriptId.get(scriptId);
  //     if (!scriptUrl) continue;
  //     const scriptPath = fileURLToPath(scriptUrl);
  //     await Runtime.evaluate({
  //       expression: `debug(require(${JSON.stringify(scriptPath)}))`,
  //       includeCommandLineAPI: true,
  //     });
  //   }
  // }

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
    console.log('a.test.js', result.find(({ url }) => url.endsWith('a.test.js')).functions[0]);
  }
}
module.exports = test;
