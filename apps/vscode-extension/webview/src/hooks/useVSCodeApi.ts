interface VSCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare global {
  function acquireVsCodeApi(): VSCodeApi;
}

let api: VSCodeApi | undefined;

export function useVSCodeApi() {
  if (!api) {
    try {
      api = acquireVsCodeApi();
    } catch (e) {
      // Mock for browser environment
      api = {
        postMessage: (msg: any) => console.log('postMessage:', msg),
        getState: () => ({}),
        setState: (state: any) => console.log('setState:', state)
      };
    }
  }
  return api;
}
