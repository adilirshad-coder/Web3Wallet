import { createHash } from "node:crypto";
import { ApiError } from "../errors.js";

export interface IdempotencyRecord { fingerprint: string; response: unknown; createdAt: number }
export interface IdempotencyStore {
  get(scope: string, key: string): Promise<IdempotencyRecord | undefined>;
  put(scope: string, key: string, record: IdempotencyRecord): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();
  async get(scope: string, key: string) {
    this.prune();
    return this.records.get(`${scope}:${key}`);
  }
  async put(scope: string, key: string, record: IdempotencyRecord) {
    this.prune();
    this.records.set(`${scope}:${key}`, record);
  }
  private prune() {
    const cutoff = Date.now() - 24 * 60 * 60_000;
    for (const [key, record] of this.records) if (record.createdAt <= cutoff) this.records.delete(key);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function bodyFingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export async function executeIdempotent<T>(store: IdempotencyStore, scope: string, key: string | undefined, body: unknown, operation: () => Promise<T>): Promise<T> {
  if (!key?.trim() || key.length > 200) throw new ApiError(400, "idempotency_key_required", "A valid Idempotency-Key header is required");
  const fingerprint = bodyFingerprint(body);
  const prior = await store.get(scope, key);
  if (prior) {
    if (prior.fingerprint !== fingerprint) throw new ApiError(409, "idempotency_conflict", "This idempotency key was already used with a different request");
    return prior.response as T;
  }
  const pendingByStore = pending.get(store) ?? new Map<string, { fingerprint: string; promise: Promise<unknown> }>();
  pending.set(store, pendingByStore);
  const pendingKey = `${scope}:${key}`;
  const inFlight = pendingByStore.get(pendingKey);
  if (inFlight) {
    if (inFlight.fingerprint !== fingerprint) throw new ApiError(409, "idempotency_conflict", "This idempotency key was already used with a different request");
    return await inFlight.promise as T;
  }
  const promise = (async () => {
    const response = await operation();
    await store.put(scope, key, { fingerprint, response, createdAt: Date.now() });
    return response;
  })();
  pendingByStore.set(pendingKey, { fingerprint, promise });
  try { return await promise as T; }
  finally { pendingByStore.delete(pendingKey); }
}

const pending = new WeakMap<IdempotencyStore, Map<string, { fingerprint: string; promise: Promise<unknown> }>>();
