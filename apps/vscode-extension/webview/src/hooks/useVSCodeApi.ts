import type { WebviewMessage } from '@project-dna/shared';

interface VSCodeApi<State = unknown> {
  postMessage(message: WebviewMessage): void;
  getState(): State | undefined;
  setState(state: State): void;
}

declare global {
  function acquireVsCodeApi<State = unknown>(): VSCodeApi<State>;
}

let api: VSCodeApi | undefined;

export function useVSCodeApi(): VSCodeApi {
  if (!api) {
    try {
      api = acquireVsCodeApi();
    } catch {
      api = {
        postMessage: () => undefined,
        getState: () => undefined,
        setState: () => undefined,
      };
    }
  }
  return api;
}
