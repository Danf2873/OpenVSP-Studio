// Transport layer: Tauri invoke when running in the desktop shell, otherwise a
// WebSocket to the engine. Both speak the same JSON contract (docs/API.md).

import type {
  EngineEvent,
  EngineStatus,
  FileFilter,
  LogEvent,
  RpcErrorPayload,
} from "./types";

// ---------- errors ----------

export class RpcError extends Error {
  readonly code: number;
  readonly traceback: string | null;

  constructor(message: string, code = -1, traceback: string | null = null) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.traceback = traceback;
  }
}

function toRpcError(err: unknown): RpcError {
  if (err instanceof RpcError) return err;
  if (typeof err === "string") return new RpcError(err);
  if (err && typeof err === "object") {
    const e = err as Partial<RpcErrorPayload> & { message?: unknown };
    const message = typeof e.message === "string" ? e.message : "Unknown engine error";
    return new RpcError(
      message,
      typeof e.code === "number" ? e.code : -1,
      typeof e.traceback === "string" ? e.traceback : null,
    );
  }
  return new RpcError("Unknown engine error");
}

// ---------- Tauri globals (withGlobalTauri) ----------

interface TauriGlobal {
  core: {
    invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  event: {
    listen: <T>(
      event: string,
      handler: (e: { payload: T }) => void,
    ) => Promise<() => void>;
  };
  dialog: {
    open: (opts: Record<string, unknown>) => Promise<string | string[] | null>;
    save: (opts: Record<string, unknown>) => Promise<string | null>;
  };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

function tauri(): TauriGlobal | undefined {
  return typeof window !== "undefined" ? window.__TAURI__ : undefined;
}

/** True when running inside the Tauri shell (evaluated once at load). */
export const isTauri: boolean = tauri() !== undefined;

// ---------- subscriptions ----------

type Unsub = () => void;

const eventHandlers = new Set<(e: EngineEvent) => void>();
const logHandlers = new Set<(e: LogEvent) => void>();
const statusHandlers = new Set<(s: EngineStatus) => void>();
const errorHandlers = new Set<(err: RpcError, method: string) => void>();

export function onEvent(handler: (e: EngineEvent) => void): Unsub {
  eventHandlers.add(handler);
  return () => {
    eventHandlers.delete(handler);
  };
}

export function onLog(handler: (e: LogEvent) => void): Unsub {
  logHandlers.add(handler);
  return () => {
    logHandlers.delete(handler);
  };
}

export function onStatus(handler: (s: EngineStatus) => void): Unsub {
  statusHandlers.add(handler);
  return () => {
    statusHandlers.delete(handler);
  };
}

/** Fired for every failed call that was not made with { silent: true }. */
export function onCallError(handler: (err: RpcError, method: string) => void): Unsub {
  errorHandlers.add(handler);
  return () => {
    errorHandlers.delete(handler);
  };
}

function emitLog(e: LogEvent): void {
  logHandlers.forEach((h) => h(e));
}

function emitStatus(s: EngineStatus): void {
  statusHandlers.forEach((h) => h(s));
}

function reportError(err: RpcError, method: string): void {
  errorHandlers.forEach((h) => h(err, method));
}

// ---------- jobs ----------

interface JobOutcome {
  ok: boolean;
  result?: unknown;
  error?: RpcError;
  at: number;
}

const jobWaiters = new Map<string, { resolve: (v: unknown) => void; reject: (e: RpcError) => void }>();
const finishedJobs = new Map<string, JobOutcome>();

function jobErrorOf(raw: RpcErrorPayload | string | undefined): RpcError {
  if (typeof raw === "string") return new RpcError(raw);
  return toRpcError(raw ?? { message: "Job failed" });
}

function settleJob(jobId: string, result: unknown, rawError: RpcErrorPayload | string | undefined): void {
  const hasError = rawError !== undefined && rawError !== null;
  const waiter = jobWaiters.get(jobId);
  const error = hasError ? jobErrorOf(rawError) : undefined;
  if (waiter) {
    jobWaiters.delete(jobId);
    if (error) waiter.reject(error);
    else waiter.resolve(result);
    return;
  }
  // job_done raced ahead of the {jobId} response; keep it briefly for runJob.
  const now = Date.now();
  finishedJobs.forEach((v, k) => {
    if (now - v.at > 60_000) finishedJobs.delete(k);
  });
  finishedJobs.set(jobId, { ok: !error, result, error, at: now });
}

// ---------- dispatch ----------

function dispatchEngineEvent(e: EngineEvent): void {
  // In Tauri, log lines arrive on "engine://log"; skip the duplicate event.
  if (e.event === "log") {
    if (!isTauri) emitLog(e.data as LogEvent);
  } else if (e.event === "job_done") {
    const d = e.data as { jobId: string; result?: unknown; error?: RpcErrorPayload | string };
    settleJob(d.jobId, d.result, d.error);
  }
  eventHandlers.forEach((h) => h(e));
}

// ---------- Tauri transport ----------

let tauriStarted = false;

function startTauri(t: TauriGlobal): void {
  if (tauriStarted) return;
  tauriStarted = true;
  void t.event.listen<EngineEvent>("engine://event", (e) => dispatchEngineEvent(e.payload));
  void t.event.listen<LogEvent>("engine://log", (e) => emitLog(e.payload));
  void t.event.listen<EngineStatus>("engine://status", (e) => emitStatus(e.payload));
}

async function tauriCall(t: TauriGlobal, method: string, params?: Record<string, unknown>): Promise<unknown> {
  return t.core.invoke("vsp_call", { method, params: params ?? {} });
}

// ---------- WebSocket transport ----------

const WS_URL = "ws://127.0.0.1:8765/ws";

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: RpcError) => void;
  method: string;
  sent: boolean;
}

let ws: WebSocket | null = null;
let wsOpen = false;
let wsStarted = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 1;
const pending = new Map<number, PendingCall>();
const outbox: { id: number; frame: string }[] = [];

function flushOutbox(): void {
  if (!ws || !wsOpen) return;
  while (outbox.length > 0) {
    const item = outbox.shift();
    if (!item) break;
    const p = pending.get(item.id);
    if (!p) continue;
    p.sent = true;
    ws.send(item.frame);
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  const delay = Math.min(250 * 2 ** reconnectAttempt, 5000);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

function connectWs(): void {
  let socket: WebSocket;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    wsOpen = true;
    reconnectAttempt = 0;
    emitStatus({ running: true });
    flushOutbox();
  };

  socket.onmessage = (ev: MessageEvent) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof msg.event === "string") {
      dispatchEngineEvent({ event: msg.event, data: msg.data } as EngineEvent);
      return;
    }
    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (msg.error && typeof msg.error === "object") {
      const e = msg.error as RpcErrorPayload;
      p.reject(new RpcError(e.message, e.code, e.traceback ?? null));
    } else {
      p.resolve(msg.result);
    }
  };

  socket.onclose = () => {
    wsOpen = false;
    if (ws === socket) ws = null;
    // Calls already on the wire are lost; calls still in the outbox stay queued.
    pending.forEach((p, id) => {
      if (p.sent) {
        pending.delete(id);
        p.reject(new RpcError("Engine connection closed", -2));
      }
    });
    emitStatus({ running: false });
    scheduleReconnect();
  };

  socket.onerror = () => {
    // onclose follows; reconnect is scheduled there.
  };
}

function ensureWs(): void {
  if (wsStarted) return;
  wsStarted = true;
  connectWs();
}

function wsCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
  ensureWs();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const frame = JSON.stringify({ id, method, params: params ?? {} });
    pending.set(id, { resolve, reject, method, sent: false });
    outbox.push({ id, frame });
    flushOutbox();
  });
}

// ---------- public API ----------

/** Start the transport (idempotent). Calls also start it lazily. */
export function startTransport(): void {
  const t = tauri();
  if (t) startTauri(t);
  else ensureWs();
}

export interface CallOptions {
  /** Do not raise a toast when this call fails (used for polling/boot calls). */
  silent?: boolean;
}

/** Call an engine method. Resolves with the `result` field. */
export function call<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  opts?: CallOptions,
): Promise<T> {
  const t = tauri();
  const run = t ? tauriCall(t, method, params) : wsCall(method, params);
  if (t) startTauri(t);
  return run.then(
    (r) => r as T,
    (err: unknown) => {
      const e = toRpcError(err);
      if (!opts?.silent) reportError(e, method);
      throw e;
    },
  );
}

/**
 * Run a long method. The engine answers {jobId} immediately and later sends
 * job_done; this resolves with job_done.result, or rejects with its error.
 */
export async function runJob<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  opts?: CallOptions,
): Promise<T> {
  const started = await call<{ jobId: string }>(method, params, opts);
  const jobId = started.jobId;

  const early = finishedJobs.get(jobId);
  if (early) {
    finishedJobs.delete(jobId);
    if (early.error) {
      if (!opts?.silent) reportError(early.error, method);
      throw early.error;
    }
    return early.result as T;
  }

  return new Promise<T>((resolve, reject) => {
    jobWaiters.set(jobId, {
      resolve: (v) => resolve(v as T),
      reject: (e) => {
        if (!opts?.silent) reportError(e, method);
        reject(e);
      },
    });
  });
}

/** Decode base64 little-endian float32 data. */
export function decodeF32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const n = bytes.byteLength >>> 2;
  if (HOST_LITTLE_ENDIAN) return new Float32Array(bytes.slice(0, n * 4).buffer);
  const dv = new DataView(bytes.buffer);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

/** Decode base64 little-endian uint32 data. */
export function decodeU32(b64: string): Uint32Array {
  const bytes = base64ToBytes(b64);
  const n = bytes.byteLength >>> 2;
  if (HOST_LITTLE_ENDIAN) return new Uint32Array(bytes.slice(0, n * 4).buffer);
  const dv = new DataView(bytes.buffer);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, true);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  if (b64.length === 0) return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// ---------- dialogs ----------

export const dialogs = {
  /** Native open dialog: Tauri's own, or one opened by the engine in browser mode. */
  async open(opts: { filters?: FileFilter[]; multiple?: boolean; title?: string }): Promise<string | string[] | null> {
    const t = tauri();
    if (t) {
      return t.dialog.open({ filters: opts.filters, multiple: !!opts.multiple, title: opts.title });
    }
    return call<string | string[] | null>("app.fileDialog", {
      mode: "open",
      title: opts.title,
      filters: opts.filters,
      multiple: !!opts.multiple,
    });
  },

  /** Native save dialog: Tauri's own, or one opened by the engine in browser mode. */
  async save(opts: { filters?: FileFilter[]; defaultPath?: string; title?: string }): Promise<string | null> {
    const t = tauri();
    if (t) {
      return t.dialog.save({ filters: opts.filters, defaultPath: opts.defaultPath, title: opts.title });
    }
    return call<string | null>("app.fileDialog", {
      mode: "save",
      title: opts.title,
      filters: opts.filters,
      defaultPath: opts.defaultPath,
    });
  },
};

/** Tauri-only commands (no-ops with a rejected promise in the browser). */
export function tauriInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t) return Promise.reject(new RpcError("Not running in the desktop app"));
  return t.core.invoke<T>(cmd, args);
}
