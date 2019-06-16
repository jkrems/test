'use strict';

const { Session, open } = require('inspector');

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

class InspectorReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;

    this._session = new Session();
    this._session.connect();

    this._urlFromScriptId = new Map();
    this._session.on('Debugger.scriptParsed', ({ params: { scriptId, url } }) => {
      this._urlFromScriptId.set(scriptId, url);
    });

    this._errorInfo = null;
  }

  async onRunStart() {
    const session = this._session;

    const Debugger = getDomain(this._session, 'Debugger');
    const Runtime = getDomain(this._session, 'Runtime');

    session.on('Debugger.paused', ({ params }) => {
      // TODO: ignore paused states we didn't trigger
      console.log('break on %j', params.reason, /* error */ params.data);

      this._errorInfo = params.data;
      session.post('Debugger.resume');
    });

    await Debugger.enable();
    await Runtime.enable();
  }

  async onTestStart() {
    console.log('set pause all');
    const Debugger = getDomain(this._session, 'Debugger');
    await Debugger.setPauseOnExceptions({ state: 'all' });

    this._errorInfo = null;
  }

  async onTestResult() {
    const Debugger = getDomain(this._session, 'Debugger');
    await Debugger.setPauseOnExceptions({ state: 'none' });

    console.log('test result', this._errorInfo);
  }

  onRunComplete(contexts, results) {
    console.log('run complete');
  }
}
module.exports = InspectorReporter;
