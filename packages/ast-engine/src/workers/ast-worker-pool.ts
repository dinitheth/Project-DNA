import { Worker } from 'node:worker_threads';
import type {
  FileInput,
  ParseResult,
} from '@project-dna/dna-core/src/interfaces/ast-engine.interface.js';
import { Err, Ok, type Result } from '@project-dna/shared/src/result/result.js';
import {
  deserializeWorkerError,
  isAstWorkerParseResponse,
  type AstWorkerParseRequest,
} from './ast-worker-protocol.js';

type WorkerEvent = 'message' | 'error' | 'exit';
type WorkerListener = (value: unknown) => void;

export interface AstWorkerLike {
  on(event: WorkerEvent, listener: WorkerListener): void;
  postMessage(message: AstWorkerParseRequest): void;
  terminate(): Promise<number>;
}

export type AstWorkerFactory = (scriptPath: string, workerIndex: number) => AstWorkerLike;

export interface AstWorkerPoolOptions {
  readonly workerCount: number;
  readonly workerScriptPath: string;
  readonly workerFactory?: AstWorkerFactory;
}

export class AstWorkerPoolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AstWorkerPoolError';
  }
}

export class AstWorkerPoolCancelledError extends Error {
  constructor() {
    super('AST parsing cancelled');
    this.name = 'AstWorkerPoolCancelledError';
  }
}

interface WorkerSlot {
  readonly index: number;
  readonly worker: AstWorkerLike;
  taskIndex: number | null;
}

/** Bounded worker pool that schedules canonically and returns results in input order. */
export class DeterministicAstWorkerPool {
  private readonly workerFactory: AstWorkerFactory;

  constructor(private readonly options: AstWorkerPoolOptions) {
    if (!Number.isInteger(options.workerCount) || options.workerCount < 1) {
      throw new Error('AST worker count must be a positive integer');
    }
    this.workerFactory = options.workerFactory ?? createNodeWorker;
  }

  async parse(
    inputs: readonly FileInput[],
    signal?: AbortSignal,
  ): Promise<Array<Result<ParseResult>>> {
    if (inputs.length === 0) return [];
    if (signal?.aborted) throw new AstWorkerPoolCancelledError();

    const workerCount = Math.min(this.options.workerCount, inputs.length);
    const slots: WorkerSlot[] = [];
    try {
      for (let index = 0; index < workerCount; index++) {
        slots.push({
          index,
          worker: this.workerFactory(this.options.workerScriptPath, index),
          taskIndex: null,
        });
      }
      return await this.run(slots, inputs, signal);
    } finally {
      await Promise.allSettled(slots.map((slot) => slot.worker.terminate()));
    }
  }

  /** Yield a completed batch canonically while releasing buffered results as they are consumed. */
  async *parseAndRelease(
    inputs: readonly FileInput[],
    signal?: AbortSignal,
  ): AsyncGenerator<Result<ParseResult>> {
    if (inputs.length === 0) return;
    if (signal?.aborted) throw new AstWorkerPoolCancelledError();

    const workerCount = Math.min(this.options.workerCount, inputs.length);
    const slots: WorkerSlot[] = [];
    try {
      for (let index = 0; index < workerCount; index++) {
        slots.push({
          index,
          worker: this.workerFactory(this.options.workerScriptPath, index),
          taskIndex: null,
        });
      }
      for await (const result of this.stream(slots, inputs, signal)) yield result;
    } finally {
      await Promise.allSettled(slots.map((slot) => slot.worker.terminate()));
    }
  }

  private async *stream(
    slots: readonly WorkerSlot[],
    inputs: readonly FileInput[],
    signal?: AbortSignal,
  ): AsyncGenerator<Result<ParseResult>> {
    const results = new Map<number, Result<ParseResult>>();
    const idleSlots: WorkerSlot[] = [];
    let nextTaskIndex = 0;
    let nextResultIndex = 0;
    let failure: Error | null = null;
    let wakeConsumer: (() => void) | null = null;

    const wake = (): void => {
      wakeConsumer?.();
      wakeConsumer = null;
    };
    const fail = (error: Error): void => {
      if (failure) return;
      failure = error;
      wake();
    };
    const abort = (): void => fail(new AstWorkerPoolCancelledError());
    const dispatch = (slot: WorkerSlot): void => {
      if (failure || signal?.aborted) {
        if (signal?.aborted) abort();
        return;
      }
      const taskIndex = nextTaskIndex++;
      const input = inputs[taskIndex];
      if (!input) {
        slot.taskIndex = null;
        return;
      }
      slot.taskIndex = taskIndex;
      try {
        slot.worker.postMessage({ type: 'parse', taskId: taskIndex, input });
      } catch (error) {
        fail(workerFailure(slot, error));
      }
    };
    const dispatchIdleSlots = (): void => {
      idleSlots.sort((left, right) => left.index - right.index);
      while (idleSlots.length > 0 && nextTaskIndex < inputs.length && !failure) {
        const slot = idleSlots.shift();
        if (slot) dispatch(slot);
      }
    };

    signal?.addEventListener('abort', abort, { once: true });
    for (const slot of slots) {
      slot.worker.on('message', (message) => {
        if (failure) return;
        if (!isAstWorkerParseResponse(message)) {
          fail(workerFailure(slot, new Error('Invalid AST worker response')));
          return;
        }
        if (slot.taskIndex === null || message.taskId !== slot.taskIndex) {
          fail(workerFailure(slot, new Error('Out-of-order AST worker response')));
          return;
        }
        results.set(
          message.taskId,
          message.ok ? Ok(message.value) : Err(deserializeWorkerError(message.error)),
        );
        slot.taskIndex = null;
        idleSlots.push(slot);
        wake();
      });
      slot.worker.on('error', (error) => fail(workerFailure(slot, error)));
      slot.worker.on('exit', (code) => {
        if (failure || nextResultIndex === inputs.length) return;
        fail(
          workerFailure(slot, new Error(`AST worker exited before completion with code ${code}`)),
        );
      });
      dispatch(slot);
    }

    try {
      while (nextResultIndex < inputs.length) {
        while (!failure && !results.has(nextResultIndex)) {
          await new Promise<void>((resolve) => {
            wakeConsumer = resolve;
            if (failure || results.has(nextResultIndex)) wake();
          });
        }
        if (failure) throw failure;
        const result = results.get(nextResultIndex);
        if (!result) {
          throw new AstWorkerPoolError(
            `AST worker pool result ${nextResultIndex} was released prematurely`,
          );
        }
        results.delete(nextResultIndex);
        nextResultIndex++;
        dispatchIdleSlots();
        yield result;
      }
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  private run(
    slots: readonly WorkerSlot[],
    inputs: readonly FileInput[],
    signal?: AbortSignal,
  ): Promise<Array<Result<ParseResult>>> {
    const results: Array<Result<ParseResult> | undefined> = new Array(inputs.length);
    let nextTaskIndex = 0;
    let completed = 0;
    let settled = false;

    return new Promise((resolve, reject) => {
      const finishWithError = (error: Error): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        reject(error);
      };
      const abort = (): void => finishWithError(new AstWorkerPoolCancelledError());
      const finishIfComplete = (): void => {
        if (settled || completed !== inputs.length) return;
        const ordered = results.filter(
          (result): result is Result<ParseResult> => result !== undefined,
        );
        if (ordered.length !== inputs.length) {
          finishWithError(new AstWorkerPoolError('AST worker pool completed with missing results'));
          return;
        }
        settled = true;
        signal?.removeEventListener('abort', abort);
        resolve(ordered);
      };
      const dispatch = (slot: WorkerSlot): void => {
        if (settled) return;
        if (signal?.aborted) {
          abort();
          return;
        }
        const taskIndex = nextTaskIndex++;
        const input = inputs[taskIndex];
        if (!input) {
          slot.taskIndex = null;
          finishIfComplete();
          return;
        }
        slot.taskIndex = taskIndex;
        try {
          slot.worker.postMessage({ type: 'parse', taskId: taskIndex, input });
        } catch (error) {
          finishWithError(workerFailure(slot, error));
        }
      };

      signal?.addEventListener('abort', abort, { once: true });
      for (const slot of slots) {
        slot.worker.on('message', (message) => {
          if (settled) return;
          if (!isAstWorkerParseResponse(message)) {
            finishWithError(workerFailure(slot, new Error('Invalid AST worker response')));
            return;
          }
          if (slot.taskIndex === null || message.taskId !== slot.taskIndex) {
            finishWithError(workerFailure(slot, new Error('Out-of-order AST worker response')));
            return;
          }
          results[message.taskId] = message.ok
            ? Ok(message.value)
            : Err(deserializeWorkerError(message.error));
          completed++;
          slot.taskIndex = null;
          dispatch(slot);
        });
        slot.worker.on('error', (error) => finishWithError(workerFailure(slot, error)));
        slot.worker.on('exit', (code) => {
          if (settled) return;
          finishWithError(
            workerFailure(slot, new Error(`AST worker exited before completion with code ${code}`)),
          );
        });
        dispatch(slot);
      }
    });
  }
}

function createNodeWorker(scriptPath: string): AstWorkerLike {
  const worker = new Worker(scriptPath);
  return {
    on: (event, listener) => {
      worker.on(event, listener);
    },
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
}

function workerFailure(slot: WorkerSlot, error: unknown): AstWorkerPoolError {
  const cause = error instanceof Error ? error : new Error(String(error));
  return new AstWorkerPoolError(`AST worker ${slot.index} failed: ${cause.message}`, { cause });
}
