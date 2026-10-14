import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import { TypeBoxTypeProvider, TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { FormatRegistry } from "@sinclair/typebox";
import { PublicKey } from "@solana/web3.js";
import type { ApiConfig } from "./config.js";
import { ApiError, mapError } from "./errors.js";
import { registerSwapRoutes } from "./routes/swap.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerReadRoutes } from "./routes/read.js";
import { registerTransactionRoutes } from "./routes/transactions.js";
import type { RpcService } from "./services/rpc.js";
import type { TransactionBuilderService } from "./services/tx-builder.js";
import { createAuthService, type AuthService } from "./services/auth.js";
import { MemoryIdempotencyStore, type IdempotencyStore } from "./services/idempotency.js";
import { createSubmitService, type SubmitService } from "./services/submit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSubmitRoutes } from "./routes/submit.js";
import { registerIntegrationRoutes, type KycProvider, type OnRampSessions } from "./routes/integrations.js";
import { decodeBase58 } from "./program/base58.js";
import { MemoryEventStore, type EventStore } from "./services/event-store.js";
import { NullAttestationJobQueue, type AttestationJobQueue } from "./services/attestation-queue.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export interface AppDeps {
  config: ApiConfig;
  rpc: RpcService;
  txBuilder?: TransactionBuilderService;
  auth?: AuthService;
  submit?: SubmitService;
  idempotency?: IdempotencyStore;
  kyc?: KycProvider;
  onramp?: OnRampSessions;
  events?: EventStore;
  attestations?: AttestationJobQueue;
  logger?: boolean | object;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: deps.logger ?? { level: "info", redact: { paths: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-wallet-signature", "req.body.signature", "req.body.signedTransaction", "req.body.secret", "req.body.seed", "req.body.privateKey"], censor: "[REDACTED]" } },
    trustProxy: deps.config.trustProxy,
    bodyLimit: 64 * 1024,
    connectionTimeout: 15_000,
    requestTimeout: 20_000,
    keepAliveTimeout: 5_000,
  }).withTypeProvider<TypeBoxTypeProvider>();
  app.decorateRequest("rawBody", null);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const raw = Buffer.from(body as Buffer);
    (request as typeof request & { rawBody: Buffer }).rawBody = raw;
    try { done(null, JSON.parse(raw.toString("utf8"))); }
    catch { done(new ApiError(400, "validation_error", "Request body must be valid JSON")); }
  });
  FormatRegistry.Set("base58", (value) => {
    try { const decoded = new PublicKey(value); return decoded.toBytes().length === 32 && decoded.toBase58() === value; } catch { return false; }
  });
  FormatRegistry.Set("u64", (value) => {
    if (!/^[0-9]+$/.test(value)) return false;
    try { const parsed = BigInt(value); return parsed >= 1n && parsed <= 18_446_744_073_709_551_615n; } catch { return false; }
  });
  FormatRegistry.Set("date-time", (value) => !Number.isNaN(Date.parse(value)) && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value));
  FormatRegistry.Set("signatureBase64", (value) => {
    try { const decoded = Buffer.from(value, "base64"); return decoded.length === 64 && decoded.toString("base64") === value; } catch { return false; }
  });
  FormatRegistry.Set("base64Transaction", (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value));
  FormatRegistry.Set("base58Signature", (value) => {
    try { return decodeBase58(value).length === 64; } catch { return false; }
  });
  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  app.setErrorHandler((error, request, reply) => {
    if ((error as { validation?: unknown }).validation) {
      const envelope = { error: { code: "validation_error", message: "Request validation failed", requestId: request.id } };
      return reply.code(400).send(envelope);
    }
    const mapped = mapError(error);
    if (!(error instanceof ApiError) && mapped.statusCode === 500) request.log.error({ errorName: error instanceof Error ? error.name : "unknown" }, "request failed");
    const body: { error: { code: string; message: string; requestId: string; details?: unknown } } = {
      error: { code: mapped.code, message: mapped.message, requestId: request.id },
    };
    if (error instanceof ApiError && error.details !== undefined) body.error.details = error.details;
    return reply.code(mapped.statusCode).send(body);
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
      const contentType = request.headers["content-type"]?.split(";")[0].trim().toLowerCase();
      if (contentType !== "application/json") throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json");
    }
  });
  const ownerRateLimits = new Map<string, { windowStarted: number; count: number }>();
  app.addHook("preHandler", async (request) => {
    const params = request.params && typeof request.params === "object" ? request.params as Record<string, unknown> : {};
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    const owner = typeof params.owner === "string" ? params.owner : typeof body.owner === "string" ? body.owner : undefined;
    if (!owner) return;
    const now = Date.now();
    const current = ownerRateLimits.get(owner);
    const bucket = !current || current.windowStarted + 60_000 <= now ? { windowStarted: now, count: 0 } : current;
    bucket.count += 1;
    ownerRateLimits.set(owner, bucket);
    if (ownerRateLimits.size > 10_000) {
      for (const [key, value] of ownerRateLimits) if (value.windowStarted + 60_000 <= now) ownerRateLimits.delete(key);
    }
    if (bucket.count > 60) throw new ApiError(429, "rate_limited", "Too many requests for this wallet");
  });
  await app.register(helmet);
  await app.register(cors, { origin: deps.config.corsOrigins.length ? deps.config.corsOrigins : false, credentials: false });
  await app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute", errorResponseBuilder: (request) => ({ error: { code: "rate_limited", message: "Too many requests", requestId: request.id } }) });
  await app.register(swagger, { openapi: { info: { title: "Solana Wallet API", version: "0.1.0" }, servers: [{ url: "/" }] } });

  await registerHealthRoutes(app, deps.rpc);
  await registerReadRoutes(app, deps);
  if (deps.txBuilder) await registerTransactionRoutes(app, deps.txBuilder);
  await registerSwapRoutes(app, deps.config);
  const auth = deps.auth ?? createAuthService(deps.config.cluster);
  const idempotency = deps.idempotency ?? new MemoryIdempotencyStore();
  await registerAuthRoutes(app, auth);
  await registerSubmitRoutes(app, { submit: deps.submit ?? createSubmitService(deps.config), idempotency });
  await registerIntegrationRoutes(app, { auth, idempotency, config: deps.config, kyc: deps.kyc, onramp: deps.onramp });
  await registerWebhookRoutes(app, { config: deps.config, events: deps.events ?? new MemoryEventStore(), attestations: deps.attestations ?? new NullAttestationJobQueue() });
  return app;
}
