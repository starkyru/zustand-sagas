export interface WorkerHandle {
  postMessage(data: unknown): void;
  onMessage(handler: (data: unknown) => void): void;
  onError(handler: (error: Error) => void): void;
  terminate(): void;
}

export interface WorkerPlatform {
  createFromCode(code: string): WorkerHandle;
  createFromURL(url: string | URL): WorkerHandle;
}

// --- Configuration ---

export interface WorkerConfig {
  /**
   * Module format for generated Node.js worker code.
   * - `'cjs'` (default): Uses `require('node:worker_threads')`. Works in CJS projects.
   * - `'esm'`: Uses `import ... from 'node:worker_threads'`. Required when the host
   *   project sets `"type": "module"` in package.json or otherwise runs under ESM.
   */
  nodeWorkerMode: 'cjs' | 'esm';
}

let workerConfig: WorkerConfig = { nodeWorkerMode: 'cjs' };

/** Configure worker code generation. Call before any worker effects are used. */
export function configureWorkers(config: Partial<WorkerConfig>): void {
  workerConfig = { ...workerConfig, ...config };
  // Reset cached platform so it picks up the new config
  cachedPlatform = null;
  pendingInit = null;
}

// --- Browser implementation ---

function createBrowserPlatform(): WorkerPlatform {
  return {
    createFromCode(code: string): WorkerHandle {
      const blob = new Blob([code], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      return wrapBrowserWorker(worker, url);
    },
    createFromURL(url: string | URL): WorkerHandle {
      const worker = new Worker(url);
      return wrapBrowserWorker(worker, null);
    },
  };
}

function wrapBrowserWorker(worker: Worker, blobUrl: string | null): WorkerHandle {
  return {
    postMessage(data: unknown) {
      worker.postMessage(data);
    },
    onMessage(handler: (data: unknown) => void) {
      worker.onmessage = (e: MessageEvent) => handler(e.data);
    },
    onError(handler: (error: Error) => void) {
      worker.onerror = (e: ErrorEvent) => {
        e.preventDefault();
        handler(new Error(e.message));
      };
    },
    terminate() {
      worker.terminate();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    },
  };
}

// --- Node.js implementation ---

function createNodePlatform(workerThreads: any): WorkerPlatform {
  return {
    createFromCode(code: string): WorkerHandle {
      let worker;
      if (workerConfig.nodeWorkerMode === 'esm') {
        // ESM: data URL so Node evaluates the code as an ES module
        const dataUrl = `data:text/javascript,${encodeURIComponent(code)}`;
        worker = new workerThreads.Worker(new URL(dataUrl));
      } else {
        worker = new workerThreads.Worker(code, { eval: true });
      }
      return wrapNodeWorker(worker);
    },
    createFromURL(url: string | URL): WorkerHandle {
      const worker = new workerThreads.Worker(url instanceof URL ? url.href : url);
      return wrapNodeWorker(worker);
    },
  };
}

function wrapNodeWorker(worker: any): WorkerHandle {
  return {
    postMessage(data: unknown) {
      worker.postMessage(data);
    },
    onMessage(handler: (data: unknown) => void) {
      worker.on('message', handler);
    },
    onError(handler: (error: Error) => void) {
      worker.on('error', handler);
    },
    terminate() {
      worker.terminate();
    },
  };
}

// --- Platform detection (lazy, cached) ---

let cachedPlatform: WorkerPlatform | null = null;
let pendingInit: Promise<WorkerPlatform> | null = null;

export async function getPlatformAsync(): Promise<WorkerPlatform> {
  if (cachedPlatform) return cachedPlatform;
  if (pendingInit) return pendingInit;

  // Browser
  if (typeof globalThis.Worker !== 'undefined') {
    cachedPlatform = createBrowserPlatform();
    return cachedPlatform;
  }

  // Node.js — dynamic import for ESM compatibility
  // @ts-expect-error — node:worker_threads may not have type declarations
  pendingInit = import('node:worker_threads').then(
    (wt) => {
      cachedPlatform = createNodePlatform(wt);
      return cachedPlatform;
    },
    () => {
      throw new Error(
        'Worker effects require Web Worker API (browser) or worker_threads (Node.js). ' +
          'Neither is available in this environment.',
      );
    },
  );
  return pendingInit;
}

export function getPlatform(): WorkerPlatform {
  if (cachedPlatform) return cachedPlatform;

  // Browser
  if (typeof globalThis.Worker !== 'undefined') {
    cachedPlatform = createBrowserPlatform();
    return cachedPlatform;
  }

  throw new Error(
    'Worker effects require Web Worker API (browser) or worker_threads (Node.js). ' +
      'Use getPlatformAsync() in Node.js environments.',
  );
}

// --- Worker wrapper code builder ---

const WORKER_WRAPPER_BROWSER = (fnString: string) => `
const __fn = (${fnString});
self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(...msg.args);
      self.postMessage({ type: 'result', value: result });
    } catch (e) {
      self.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
};
`;

const WORKER_WRAPPER_NODE_CJS = (fnString: string) => `
const { parentPort } = require('node:worker_threads');
const __fn = (${fnString});
parentPort.on('message', async (msg) => {
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(...msg.args);
      parentPort.postMessage({ type: 'result', value: result });
    } catch (e) {
      parentPort.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
});
`;

const WORKER_WRAPPER_NODE_ESM = (fnString: string) => `
import { parentPort } from 'node:worker_threads';
const __fn = (${fnString});
parentPort.on('message', async (msg) => {
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(...msg.args);
      parentPort.postMessage({ type: 'result', value: result });
    } catch (e) {
      parentPort.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
});
`;

export type WorkerMode = 'exec' | 'channel' | 'gen';

export function buildWorkerCode(fnString: string, mode: WorkerMode = 'exec'): string {
  const isNode = typeof globalThis.Worker === 'undefined';
  const esm = isNode && workerConfig.nodeWorkerMode === 'esm';
  switch (mode) {
    case 'exec':
      return isNode
        ? esm
          ? WORKER_WRAPPER_NODE_ESM(fnString)
          : WORKER_WRAPPER_NODE_CJS(fnString)
        : WORKER_WRAPPER_BROWSER(fnString);
    case 'channel':
      return isNode
        ? esm
          ? WORKER_CHANNEL_NODE_ESM(fnString)
          : WORKER_CHANNEL_NODE_CJS(fnString)
        : WORKER_CHANNEL_BROWSER(fnString);
    case 'gen':
      return isNode
        ? esm
          ? WORKER_GEN_NODE_ESM(fnString)
          : WORKER_GEN_NODE_CJS(fnString)
        : WORKER_GEN_BROWSER(fnString);
  }
}

// --- Channel mode: worker function receives emit callback ---

const WORKER_CHANNEL_BROWSER = (fnString: string) => `
const __fn = (${fnString});
const __emit = (value) => self.postMessage({ type: 'emit', value });
self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(__emit, ...msg.args);
      self.postMessage({ type: 'result', value: result });
    } catch (e) {
      self.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
};
`;

const WORKER_CHANNEL_NODE_CJS = (fnString: string) => `
const { parentPort } = require('node:worker_threads');
const __fn = (${fnString});
const __emit = (value) => parentPort.postMessage({ type: 'emit', value });
parentPort.on('message', async (msg) => {
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(__emit, ...msg.args);
      parentPort.postMessage({ type: 'result', value: result });
    } catch (e) {
      parentPort.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
});
`;

const WORKER_CHANNEL_NODE_ESM = (fnString: string) => `
import { parentPort } from 'node:worker_threads';
const __fn = (${fnString});
const __emit = (value) => parentPort.postMessage({ type: 'emit', value });
parentPort.on('message', async (msg) => {
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(__emit, ...msg.args);
      parentPort.postMessage({ type: 'result', value: result });
    } catch (e) {
      parentPort.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
});
`;

// --- Gen mode: worker function receives send(value) -> Promise<response> ---

const WORKER_GEN_BROWSER = (fnString: string) => `
const __fn = (${fnString});
let __pendingResolve = null;
const __send = (value) => new Promise((resolve) => {
  __pendingResolve = resolve;
  self.postMessage({ type: 'send', value });
});
self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(__send, ...msg.args);
      self.postMessage({ type: 'result', value: result });
    } catch (e) {
      self.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
  if (msg.type === 'response') {
    if (__pendingResolve) {
      const resolve = __pendingResolve;
      __pendingResolve = null;
      resolve(msg.value);
    }
  }
};
`;

const WORKER_GEN_NODE_CJS = (fnString: string) => `
const { parentPort } = require('node:worker_threads');
const __fn = (${fnString});
let __pendingResolve = null;
const __send = (value) => new Promise((resolve) => {
  __pendingResolve = resolve;
  parentPort.postMessage({ type: 'send', value });
});
parentPort.on('message', async (msg) => {
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(__send, ...msg.args);
      parentPort.postMessage({ type: 'result', value: result });
    } catch (e) {
      parentPort.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
  if (msg.type === 'response') {
    if (__pendingResolve) {
      const resolve = __pendingResolve;
      __pendingResolve = null;
      resolve(msg.value);
    }
  }
});
`;

const WORKER_GEN_NODE_ESM = (fnString: string) => `
import { parentPort } from 'node:worker_threads';
const __fn = (${fnString});
let __pendingResolve = null;
const __send = (value) => new Promise((resolve) => {
  __pendingResolve = resolve;
  parentPort.postMessage({ type: 'send', value });
});
parentPort.on('message', async (msg) => {
  if (msg.type === 'cancel') return;
  if (msg.type === 'exec') {
    try {
      const result = await __fn(__send, ...msg.args);
      parentPort.postMessage({ type: 'result', value: result });
    } catch (e) {
      parentPort.postMessage({ type: 'error', message: e.message, stack: e.stack });
    }
  }
  if (msg.type === 'response') {
    if (__pendingResolve) {
      const resolve = __pendingResolve;
      __pendingResolve = null;
      resolve(msg.value);
    }
  }
});
`;
