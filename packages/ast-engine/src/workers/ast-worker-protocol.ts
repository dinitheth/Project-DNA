import type {
  FileInput,
  ParseResult,
} from '@project-dna/dna-core/src/interfaces/ast-engine.interface.js';

export interface AstWorkerParseRequest {
  readonly type: 'parse';
  readonly taskId: number;
  readonly input: FileInput;
}

export interface AstWorkerErrorData {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export type AstWorkerParseResponse =
  | {
      readonly type: 'result';
      readonly taskId: number;
      readonly ok: true;
      readonly value: ParseResult;
    }
  | {
      readonly type: 'result';
      readonly taskId: number;
      readonly ok: false;
      readonly error: AstWorkerErrorData;
    };

export function isAstWorkerParseResponse(value: unknown): value is AstWorkerParseResponse {
  if (!isRecord(value) || value['type'] !== 'result' || !Number.isInteger(value['taskId'])) {
    return false;
  }
  if (value['ok'] === true) return isRecord(value['value']);
  if (value['ok'] !== false || !isRecord(value['error'])) return false;
  return (
    typeof value['error']['name'] === 'string' && typeof value['error']['message'] === 'string'
  );
}

export function serializeWorkerError(error: unknown): AstWorkerErrorData {
  const resolved = error instanceof Error ? error : new Error(String(error));
  return {
    name: resolved.name,
    message: resolved.message,
    ...(resolved.stack ? { stack: resolved.stack } : {}),
  };
}

export function deserializeWorkerError(error: AstWorkerErrorData): Error {
  const resolved = new Error(error.message);
  resolved.name = error.name;
  if (error.stack) resolved.stack = error.stack;
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
