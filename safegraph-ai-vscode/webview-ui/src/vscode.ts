export interface VSCodeWrapper {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare const acquireVsCodeApi: () => VSCodeWrapper;

let api: VSCodeWrapper | undefined;

export function getVSCodeAPI(): VSCodeWrapper {
  if (!api) {
    try {
      api = acquireVsCodeApi();
    } catch {
      // Fallback for browser testing
      api = {
        postMessage: (message: unknown) => console.log("postMessage", message),
        getState: () => ({}),
        setState: (state: unknown) => console.log("setState", state),
      };
    }
  }
  return api;
}
