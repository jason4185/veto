export type RpcPriority = "user" | "background";

export type RpcMetric = {
  method: string;
  started: number;
  succeeded: number;
  failed: number;
  deduped: number;
  rateLimited: number;
  totalDurationMs: number;
};

export type VetoRpcDiagnostics = {
  requests: number;
  successes: number;
  failures: number;
  deduped: number;
  rateLimited: number;
  cooldownRemainingMs: number;
  byMethod: RpcMetric[];
};

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15_000;
const MIN_RATE_LIMIT_COOLDOWN_MS = 1_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 120_000;

const inFlight = new Map<string, Promise<unknown>>();
const metrics = new Map<string, RpcMetric>();
let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
let requests = 0;
let successes = 0;
let failures = 0;
let deduped = 0;
let rateLimited = 0;

function metricFor(method: string) {
  const current = metrics.get(method);
  if (current) return current;
  const created: RpcMetric = {
    method,
    started: 0,
    succeeded: 0,
    failed: 0,
    deduped: 0,
    rateLimited: 0,
    totalDurationMs: 0,
  };
  metrics.set(method, created);
  return created;
}

function publishDiagnostics() {
  if (typeof window === "undefined" || !import.meta.env.DEV) return;
  const target = window as Window & {
    __VETO_RPC_DIAGNOSTICS__?: VetoRpcDiagnostics;
  };
  target.__VETO_RPC_DIAGNOSTICS__ = getVetoRpcDiagnostics();
}

function technicalText(reason: unknown) {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function headerRetryAfter(reason: unknown): number | undefined {
  const response =
    reason && typeof reason === "object"
      ? (reason as { response?: { headers?: Headers } }).response
      : undefined;
  const header = response?.headers?.get?.("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1_000;
  const timestamp = Date.parse(header);
  return Number.isFinite(timestamp) ? timestamp - Date.now() : undefined;
}

export function isRpcRateLimitError(reason: unknown) {
  return /rate limit|too many requests|too many request|\b429\b/i.test(technicalText(reason));
}

export function rateLimitCooldownMs(reason: unknown) {
  const header = headerRetryAfter(reason);
  if (header !== undefined)
    return Math.min(
      MAX_RATE_LIMIT_COOLDOWN_MS,
      Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, Math.ceil(header)),
    );
  const text = technicalText(reason);
  if (/requests?\s+per\s+minute/i.test(text)) return 60_000;
  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

export class VetoRpcRateLimitError extends Error {
  readonly retryAt: number;
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`GenLayer Studio Next is rate limited. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = "VetoRpcRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.retryAt = Date.now() + retryAfterMs;
  }
}

function beginCooldown(reason: unknown) {
  const retryAfterMs = rateLimitCooldownMs(reason);
  cooldownUntil = Math.max(cooldownUntil, Date.now() + retryAfterMs);
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(
    () => {
      cooldownUntil = 0;
      cooldownTimer = undefined;
      publishDiagnostics();
    },
    Math.max(0, cooldownUntil - Date.now()),
  );
  return retryAfterMs;
}

export function getRpcCooldownRemainingMs() {
  return Math.max(0, cooldownUntil - Date.now());
}

export function getVetoRpcDiagnostics(): VetoRpcDiagnostics {
  return {
    requests,
    successes,
    failures,
    deduped,
    rateLimited,
    cooldownRemainingMs: getRpcCooldownRemainingMs(),
    byMethod: [...metrics.values()].map((metric) => ({ ...metric })),
  };
}

export function resetVetoRpcDiagnostics() {
  inFlight.clear();
  metrics.clear();
  requests = 0;
  successes = 0;
  failures = 0;
  deduped = 0;
  rateLimited = 0;
  cooldownUntil = 0;
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = undefined;
  publishDiagnostics();
}

export async function runRpcRequest<T>({
  key,
  method,
  request,
  priority = "user",
}: {
  key: string;
  method: string;
  request: () => Promise<T>;
  priority?: RpcPriority;
}): Promise<T> {
  void priority;
  const existing = inFlight.get(key);
  if (existing) {
    deduped += 1;
    metricFor(method).deduped += 1;
    publishDiagnostics();
    return existing as Promise<T>;
  }

  const remaining = getRpcCooldownRemainingMs();
  if (remaining > 0) {
    const error = new VetoRpcRateLimitError(remaining);
    rateLimited += 1;
    metricFor(method).rateLimited += 1;
    publishDiagnostics();
    throw error;
  }

  const metric = metricFor(method);
  const startedAt = performance.now();
  requests += 1;
  metric.started += 1;
  const task = (async () => {
    try {
      const result = await request();
      successes += 1;
      metric.succeeded += 1;
      return result;
    } catch (reason) {
      failures += 1;
      metric.failed += 1;
      if (isRpcRateLimitError(reason)) {
        rateLimited += 1;
        metric.rateLimited += 1;
        beginCooldown(reason);
      }
      throw reason;
    } finally {
      metric.totalDurationMs += Math.round(performance.now() - startedAt);
      publishDiagnostics();
    }
  })();
  inFlight.set(key, task);
  void task.finally(() => inFlight.delete(key)).catch(() => undefined);
  return task;
}
