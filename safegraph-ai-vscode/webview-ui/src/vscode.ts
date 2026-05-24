export interface VSCodeWrapper {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
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
        postMessage: (message: any) => console.log("postMessage", message),
        getState: () => ({}),
        setState: (state: any) => console.log("setState", state),
      };
    }
  }
  return api;
}
