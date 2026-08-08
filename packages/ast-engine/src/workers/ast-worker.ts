import { parentPort } from 'node:worker_threads';
import type { Logger } from '@project-dna/shared/src/logger/logger.js';
import { AstEngine } from '../ast-engine.js';
import {
  serializeWorkerError,
  type AstWorkerParseRequest,
  type AstWorkerParseResponse,
} from './ast-worker-protocol.js';

const port = parentPort;
if (!port) throw new Error('AST worker must run inside a worker thread');

const engine = new AstEngine(createWorkerLogger(), { workerCount: 1 });

port.on('message', async (request: AstWorkerParseRequest) => {
  if (request.type !== 'parse') return;
  let response: AstWorkerParseResponse;
  try {
    const result = await engine.parseFile(request.input);
    response = result.ok
      ? { type: 'result', taskId: request.taskId, ok: true, value: result.value }
      : {
          type: 'result',
          taskId: request.taskId,
          ok: false,
          error: serializeWorkerError(result.error),
        };
  } catch (error) {
    response = {
      type: 'result',
      taskId: request.taskId,
      ok: false,
      error: serializeWorkerError(error),
    };
  }
  port.postMessage(response);
});

function createWorkerLogger(): Logger {
  const logger: Logger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  };
  return logger;
}
