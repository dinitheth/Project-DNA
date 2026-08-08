import { describe, expect, it } from 'vitest';
import type { FileInput, ParseResult } from '@project-dna/dna-core';
import {
  AstWorkerPoolCancelledError,
  AstWorkerPoolError,
  DeterministicAstWorkerPool,
  type AstWorkerLike,
} from '../workers/ast-worker-pool.js';
import type {
  AstWorkerParseRequest,
  AstWorkerParseResponse,
} from '../workers/ast-worker-protocol.js';

describe('DeterministicAstWorkerPool', () => {
  it('merges out-of-order worker completions into canonical input order', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, (request) => Math.max(0, 20 - request.taskId));
    const results = await pool.parse(inputs(24));

    expect(results.map((result) => (result.ok ? result.value.fileDna.path : 'error'))).toEqual(
      inputs(24).map((input) => input.relativePath),
    );
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('fails the batch on worker failure so the caller can retry sequentially', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, () => 0, 1);
    await expect(pool.parse(inputs(8))).rejects.toBeInstanceOf(AstWorkerPoolError);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('fails streaming after releasing a valid canonical prefix', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, () => 0, 0, false, 4);
    const iterator = pool.parseAndRelease(inputs(12));

    const first = await iterator.next();
    expect(first.value?.ok && first.value.value.fileDna.path).toBe('src/file-0.ts');
    await expect(iterator.next()).rejects.toBeInstanceOf(AstWorkerPoolError);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('cancels parseAndRelease promptly and terminates every worker', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, () => 50);
    const controller = new AbortController();
    const iterator = pool.parseAndRelease(inputs(8), controller.signal);
    setTimeout(() => controller.abort(), 1);

    await expect(iterator.next()).rejects.toBeInstanceOf(AstWorkerPoolCancelledError);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('rejects a response that races with the slot assigned task', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, () => 0, undefined, true);

    await expect(pool.parse(inputs(4))).rejects.toBeInstanceOf(AstWorkerPoolError);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('supports repeated batches without retaining worker state', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, () => 0);
    for (let iteration = 0; iteration < 10; iteration++) {
      const results = await pool.parse(inputs(32));
      expect(results).toHaveLength(32);
    }
    expect(workers).toHaveLength(40);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });

  it('handles a large scheduled batch with bounded worker count', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, () => 0);
    const results = await pool.parse(inputs(2_000));

    expect(results).toHaveLength(2_000);
    expect(workers).toHaveLength(4);
    expect(workers.every((worker) => worker.maxInFlight === 1)).toBe(true);
  });

  it('drains 100,000 deterministic results and shuts workers down after consumption', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, () => 0);
    let count = 0;

    for await (const result of pool.parseAndRelease(inputs(100_000))) {
      const path = result.ok ? result.value.fileDna.path : 'error';
      if (path !== `src/file-${count}.ts`) throw new Error(`Unexpected result order at ${count}`);
      count++;
    }

    expect(count).toBe(100_000);
    expect(workers).toHaveLength(4);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  }, 30_000);

  it('yields the canonical prefix before the complete batch finishes', async () => {
    const workers: FakeWorker[] = [];
    const pool = createPool(workers, (request) => (request.taskId === 3 ? 100 : 0));
    const iterator = pool.parseAndRelease(inputs(8));

    const first = await iterator.next();
    expect(first.value?.ok && first.value.value.fileDna.path).toBe('src/file-0.ts');
    expect(workers.some((worker) => worker.inFlightCount > 0)).toBe(true);

    await iterator.return(undefined);
    expect(workers.every((worker) => worker.terminated)).toBe(true);
  });
});

function createPool(
  workers: FakeWorker[],
  delay: (request: AstWorkerParseRequest) => number,
  failWorkerIndex?: number,
  sendRacingResponse = false,
  failTaskId?: number,
): DeterministicAstWorkerPool {
  return new DeterministicAstWorkerPool({
    workerCount: 4,
    workerScriptPath: 'unused-worker.js',
    workerFactory: (_scriptPath, workerIndex) => {
      const worker = new FakeWorker(
        workerIndex,
        delay,
        workerIndex === failWorkerIndex,
        sendRacingResponse,
        failTaskId,
      );
      workers.push(worker);
      return worker;
    },
  });
}

function inputs(count: number): FileInput[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `C:/repo/file-${index}.ts`,
    relativePath: `src/file-${index}.ts`,
    content: `export const value${index} = ${index};`,
    language: 'typescript',
  }));
}

function parseResult(input: FileInput): ParseResult {
  return {
    fileDna: {
      id: `file-${input.relativePath}`,
      path: input.relativePath ?? input.path,
      language: input.language,
      hash: `hash-${input.relativePath ?? input.path}`,
      size: input.content.length,
      linesOfCode: 1,
      classIds: [],
      functionIds: [],
      imports: [],
      exports: [],
      comments: [],
      complexity: 1,
    },
    classes: [],
    functions: [],
  };
}

class FakeWorker implements AstWorkerLike {
  public terminated = false;
  public maxInFlight = 0;
  private inFlight = 0;
  private readonly listeners = new Map<string, Array<(value: unknown) => void>>();

  constructor(
    private readonly workerIndex: number,
    private readonly delay: (request: AstWorkerParseRequest) => number,
    private readonly shouldFail: boolean,
    private readonly sendRacingResponse: boolean,
    private readonly failTaskId?: number,
  ) {}

  public get inFlightCount(): number {
    return this.inFlight;
  }

  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  postMessage(request: AstWorkerParseRequest): void {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    if (this.shouldFail && (this.failTaskId === undefined || request.taskId === this.failTaskId)) {
      queueMicrotask(() => this.emit('error', new Error(`worker-${this.workerIndex} failed`)));
      return;
    }
    const complete = (): void => {
      this.inFlight--;
      const response: AstWorkerParseResponse = {
        type: 'result',
        taskId: this.sendRacingResponse ? request.taskId + 100 : request.taskId,
        ok: true,
        value: parseResult(request.input),
      };
      this.emit('message', response);
    };
    const delay = this.delay(request);
    if (delay <= 0) queueMicrotask(complete);
    else setTimeout(complete, delay);
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }

  private emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}
