'use strict';

const { Session } = require('inspector');
const util = require('util');

const acorn = require('acorn');
const { findNodeAround, simple: simpleWalk } = require('acorn-walk');
const async = require('async');
const kleur = require('kleur');
const stripAnsi = require('strip-ansi');

const ERROR_ID_SYMBOL_NAME = 'ExceptionContextCapture#errorId';

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

/**
 * @param {string} description
 */
function extractFunctionName(description) {
  const match = description.match(/^(?:async\s+)?function[\s*]+([^(\s]+)\s*\(/);
  if (match === null) return '';
  return `: ${match[1]}`;
}

/**
 * @param {import('inspector').Runtime.RemoteObject} result
 */
function formatResult(result) {
  switch (result.type) {
    case 'string':
      // TODO: Restrict size, maybe implement escaping ourselves..?
      //       maybe colorize JSON.stringify instead..?
      return util.inspect(result.value, { colors: kleur.enabled });

    case 'undefined':
      return kleur.gray('undefined');

    case 'number':
    case 'boolean':
      return kleur.yellow(result.unserializableValue || result.value);

    case 'function': {
      const fnName = extractFunctionName(result.description);
      return kleur.cyan(`[${result.className}${fnName}]`);
    }

    case 'object': {
      switch (result.subtype) {
        case 'date':
          // TODO: right now we lose ms precision, maybe ISO8601 would be possible..?
          return kleur.magenta(result.description);

        case 'regexp':
          return kleur.red(result.description);

        case 'error': {
          const message = `${result.description || result.className || 'Error'}`;
          return kleur.cyan(`[${message.split('\n')[0]}]`);
        }

        case 'null':
          return kleur.bold('null');
      }
      return `${result.description || result.className || '{}'}`.split('\n')[0];
    }
  }
  return kleur.magenta(result.type);
}

/**
 * @param {import('inspector').Session} session
 * @param {import('inspector').Debugger.PausedEventDataType} pausedEvent
 */
function buildContextFromCallFrames(session, pausedEvent, callback) {
  const { callFrames, data: exceptionData, asyncStackTrace: asyncTrace } = pausedEvent;

  // Find top [sync] user code frame - cheating here.
  // We can't do anything for async frames, the data is lost - realistically.
  let topUserFrame = callFrames.find(callFrame => {
    // better check:
    // 1. starts with projectDir (e.g. cwd()).
    // 2. isn't in ${projectDir}/node_modules.
    const isUserCode =
      typeof callFrame.url === 'string' && !/\/node_modules\//.test(callFrame.url);
    return isUserCode;
  }) || callFrames[0];

  async.auto({
    scriptSource: onScriptSource => {
      session.post('Debugger.getScriptSource', {
        scriptId: topUserFrame.location.scriptId,
      }, (err, { scriptSource }) => {
        onScriptSource(err, scriptSource);
      });
    },

    stmtDetails: ['scriptSource', ({ scriptSource }, onStmtDetails) => {
      // TODO: Only parse surrounding function context..?
      const oneBasedLine = topUserFrame.location.lineNumber + 1;
      const zeroBasedColumn = topUserFrame.location.columnNumber;
      let pos = -1;
      let tokenByPos = []; // sparse array with tokens
      let binaryTokenTypes = new Set([
        acorn.tokTypes.bracketL,
        acorn.tokTypes.parenL,
        acorn.tokTypes.dot,
        acorn.tokTypes.eq,
        acorn.tokTypes.assign,
        acorn.tokTypes.equality,
        acorn.tokTypes.logicalOR,
        acorn.tokTypes.logicalAND,
        acorn.tokTypes.bitwiseOR,
        acorn.tokTypes.bitwiseXOR,
        acorn.tokTypes.bitwiseAND,
        acorn.tokTypes.equality,
        acorn.tokTypes.relational,
        acorn.tokTypes.bitShift,
        acorn.tokTypes.plusMin,
        acorn.tokTypes.modulo,
        acorn.tokTypes.star,
        acorn.tokTypes.slash,
        acorn.tokTypes.starstar,
        acorn.tokTypes._in,
        acorn.tokTypes._instanceof,
      ]);
      const ast = acorn.parse(scriptSource, {
        locations: true,
        onToken(token) {
          if (token.loc.start.line === oneBasedLine &&
              token.loc.start.column === zeroBasedColumn) {
            pos = token.start;
          }
          if (binaryTokenTypes.has(token.type)) {
            // TODO: use a normal array and something like a binary search
            tokenByPos[token.start] = token;
          }
        },
      });

      // find "line" that contains the user frame
      const stmt = findNodeAround(ast, pos, 'Statement');
      if (!stmt) {
        onStmtDetails(null, '<not available>');
        return;
      }

      let primaryException = null;
      function matchesUserFrame(expr) {
        const { lineNumber, columnNumber } = topUserFrame.location;
        if (lineNumber + 1 === expr.marker.line &&
            columnNumber === expr.marker.column) {
          return true;
        }
        if (expr.node.type === 'CallExpression') {
          const callee = expr.node.callee;
          if (callee.type === 'MemberExpression') {
            if (lineNumber + 1 === callee.property.loc.start.line &&
                columnNumber === callee.property.loc.start.column) {
              return true;
            }
          } else {
            if (lineNumber + 1 === expr.start.line &&
                columnNumber === expr.start.column) {
              return true;
            }
          }
        }
        return false;
      }

      const expressions = [];
      simpleWalk(stmt.node, {
        Expression(node) {
          const expression = scriptSource.slice(node.start, node.end);
          let marker = node.loc.start;

          function setMarkerToken(left, right, tokenType, tokenValue) {
            for (let idx = left; idx < right; ++idx) {
              const token = tokenByPos[idx];
              if (!token) continue;
              if (token.type === tokenType || (tokenValue !== undefined && token.value === tokenValue)) {
                marker = token.loc.start;
                break;
              }
            }
          }

          switch (node.type) {
            case 'MemberExpression':
              setMarkerToken(
                node.object.end,
                node.property.start,
                node.computed ? acorn.tokTypes.bracketL : acorn.tokTypes.dot
              );
              break;

            case 'CallExpression':
              setMarkerToken(
                node.callee.end,
                node.arguments.length ? node.arguments[0].start : node.end,
                acorn.tokTypes.parenL
              );
              break;

            case 'BinaryExpression':
              setMarkerToken(
                node.left.end,
                node.right.start,
                null,
                node.operator
              );
              break;
          }

          const expr = {
            expression,
            marker,
            node: node,
            start: node.loc.start,
            end: node.loc.end,
          };
          expr.isPrimaryException = matchesUserFrame(expr);
          if (expr.isPrimaryException) {
            if (primaryException !== null) {
              primaryException.isPrimaryException = false;
            }
            primaryException = expr;
          }
          expressions.push(expr);
        },
      });

      // 2. find statement around frame location
      async.map(expressions, (expr, onExpressionDetails) => {
        if (expr.isPrimaryException) {
          session.post('Runtime.callFunctionOn', {
            functionDeclaration: (function getSelf() {
              return {
                type: 'object',
                subtype: 'error',
                description: this && this.stack || 'Unknown Error',
              };
            }).toString(),
            objectId: exceptionData.objectId,
            throwOnSideEffect: true,
            returnByValue: true,
            timeout: 50,
          }, (evalError, evalParams) => {
            if (evalError) {
              onExpressionDetails(evalError); // TODO: better reporting
              return;
            }
            onExpressionDetails(null, Object.assign(expr, {
              result: Object.assign(evalParams.result.value, {
                objectId: exceptionData.objectId,
              }),
            }));
          });
          return;
        }

        session.post('Debugger.evaluateOnCallFrame', {
          callFrameId: topUserFrame.callFrameId,
          expression: expr.expression,
          throwOnSideEffect: true,
          timeout: 50,
        }, (evalError, evalParams) => {
          if (evalError) {
            onExpressionDetails(evalError); // TODO: better reporting
            return;
          }
          onExpressionDetails(null, Object.assign(expr, evalParams));
        });
      }, (exprError, allExpreDetails) => {
        if (exprError) {
          onStmtDetails(exprError);
          return;
        }

        const SIDE_EFFECT = 'EvalError: Possible side-effect in debug-evaluate\n';
        const exprDetails = allExpreDetails.filter(({ result }) => {
          if (result.className === 'EvalError' &&
              result.description.startsWith(SIDE_EFFECT)) {
            return false;
          }
          return true;
        });

        const stmtSource =
          ''.padStart(stmt.node.loc.start.column, ' ') +
          scriptSource.slice(stmt.node.start, stmt.node.end);
        const maxLineNumberLength = `${stmt.node.loc.end.line}`.length;

        const lines = stmtSource
          .split('\n')
          .map((source, idx) => {
            const line = stmt.node.loc.start.line + idx;
            const paddedNumber = `${line}`.padStart(maxLineNumberLength, ' ');
            const expressions = exprDetails.filter(expr => expr.marker.line === line);
            return {
              source,
              line,
              paddedNumber,
              expressions,
              toString() {
                let formatted = `${kleur.bgWhite().black(' ' + paddedNumber + ' ')}▏${source}`;
                if (expressions.length === 0) return formatted;

                const offset = maxLineNumberLength + 3;
                const gutter = ''.padStart(offset - 1, ' ') + '▏';

                const sortedExpressions = expressions.slice(0).sort((a, b) => {
                  if (a.marker.column === b.marker.column) {
                    return a.expression.length - b.expression.length;
                  }
                  return b.marker.column - a.marker.column;
                });
                const annotationLines = ['', ''];
                let primaryErrorIdx = -1;
                for (const expr of sortedExpressions) {
                  let formattedValue = formatResult(expr.result, expr.exceptionDetails);
                  const valuePreview = expr.isPrimaryException ? `${formattedValue}` : formattedValue;
                  const len = stripAnsi(valuePreview).length;
                  const offset = expr.marker.column;
                  const endOffset = offset + len;

                  const EMPTY = /^\s*$/;
                  const lastLineHasSpace =  EMPTY.test(
                    annotationLines[annotationLines.length - 1].substr(0, endOffset + 1)
                  );
                  if (!lastLineHasSpace) {
                    annotationLines.push('');
                  }
                  const lineIdx = annotationLines.length - 1;
                  if (expr.isPrimaryException) {
                    primaryErrorIdx = lineIdx;
                  }

                  function replaceSubstr(original, startIdx, replacement) {
                    const prevPrefix = original.substr(0, startIdx).padStart(startIdx, ' ');
                    const prevPostfix = original.slice(startIdx + stripAnsi(replacement).length);
                    const newString = `${prevPrefix}${replacement}${prevPostfix}`;
                    return newString;
                  }

                  for (let i = 0; i < lineIdx; ++i) {
                    const existing = annotationLines[i][offset];
                    if (existing && existing !== ' ') continue;
                    const lineSymbol = '┆';
                    annotationLines[i] = replaceSubstr(
                      annotationLines[i],
                      offset,
                      expr.isPrimaryException ? kleur.red(lineSymbol) : lineSymbol
                    );
                  }
                  annotationLines[lineIdx] = replaceSubstr(
                    annotationLines[lineIdx],
                    offset,
                    valuePreview
                  );
                }
                return `\
${formatted}
${annotationLines.map((ann, idx) => {
  if (idx === primaryErrorIdx) {
    const errorGutter = kleur.bgRed(''.padStart(maxLineNumberLength - 1) + '🐛 ') + '▏';
    return `${errorGutter}${ann}`;
  }
  return `${gutter}${ann}`;
}).join('\n')}
${gutter}`;
              },
            };
          });

        onStmtDetails(null, lines.join('\n'));
      });
    }],

    scopes: onScopes => {
      async.map(
        topUserFrame.scopeChain.filter(scope => scope.type !== 'global'),
        (scope, onScopeInfo) => {
          session.post('Runtime.getProperties', {
            objectId: scope.object.objectId,
            ownProperties: true,
          }, (error, params) => {
            if (error) {
              onScopeInfo(error);
              return;
            }

            if (params.result.length === 0) {
              onScopeInfo(null, null);
              return;
            }

            let scopeInfo = `${kleur.bold(scope.type + ':')}`;
            for (const { name, value } of params.result) {
              scopeInfo += `\n  ${name}: ${formatResult(value)}`;
            }
            onScopeInfo(null, scopeInfo);
          });
        },
        onScopes
      );
    },

    context: ['scopes', 'stmtDetails', ({ scopes, stmtDetails }, onContext) => {
      let callStacks = `\
Sync:
${callFrames.map(frame => `  ${frame.url}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1}`).join('\n')}\
`;

      let asyncTop = asyncTrace;
      while (asyncTop) {
        callStacks += `\

${asyncTop.description}:
${asyncTop.callFrames.map(frame => `  ${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`).join('\n')}\
`;
        asyncTop = asyncTop.parent;
      }

      const context = `\
${void callStacks}

${scopes.filter(Boolean).join('\n')}

${stmtDetails}
`;

      onContext(null, context);
    }],
  }, (error, { context }) => callback(error, context));
}

class ExceptionContextCapture {
  constructor() {
    this.session = new Session();

    this.Debugger = getDomain(this.session, 'Debugger');
    this.Runtime = getDomain(this.session, 'Runtime');

    this.contextByErrorId = new Map();
    this.nextErrorId = 1;
  }

  async attach() {
    const { Debugger, Runtime, session } = this;

    session.connect();

    session.on('Debugger.paused', ({ params }) => {
      // TODO: filter params.reason=promiseRejection or params.reason=exception

      function resume(error) {
        if (error) {
          console.error(error);
        }
        // open(undefined, undefined, true);
        session.post('Debugger.resume');
      }

      try {
        buildContextFromCallFrames(session, params, (error, context) => {
          if (error) {
            resume(error);
            return;
          }

          // store context / context id
          const errId = this.nextErrorId++;
          this.contextByErrorId.set(errId, context);

          session.post('Runtime.callFunctionOn', {
            objectId: params.data.objectId,
            functionDeclaration: (function storeErrorId(symbolName, id) {
              this[Symbol.for(symbolName)] = id;
            }).toString(),
            arguments: [{ value: ERROR_ID_SYMBOL_NAME }, { value: errId }],
          }, resume);
        });
      } catch (e) {
        resume(e);
      }
    });

    await Debugger.enable();
    await Runtime.enable();

    await Debugger.setAsyncCallStackDepth({ maxDepth: 4 });
    await Debugger.setPauseOnExceptions({ state: 'all' });
  }

  async detatch() {
    const { Debugger, Runtime, session } = this;

    await Debugger.setAsyncCallStackDepth({ maxDepth: 0 });
    await Debugger.setPauseOnExceptions({ state: 'none' });

    await Debugger.disable();
    await Runtime.disable();

    session.disconnect();
  }

  getContextForError(error) {
    if (!error) return null;
    const errorId = error[Symbol.for(ERROR_ID_SYMBOL_NAME)];
    if (typeof errorId === 'number') {
      return this.contextByErrorId.get(errorId) || null;
    }
    return null;
  }

  async fromAsyncCall(fn) {
    await Promise.resolve(); // break sync stack trace

    let error = null;
    let result = null;
    try {
      result = await new Promise(resolve => resolve(fn()));
    } catch (thrownError) {
      error = thrownError;
    }

    let context = this.getContextForError(error);

    return { result, error, context };
  }
}
module.exports = ExceptionContextCapture;
