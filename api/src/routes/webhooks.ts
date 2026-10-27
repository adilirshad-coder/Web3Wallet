import { createHmac, timingSafeEqual } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { Type } from "@sinclair/typebox";
import type { ApiConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { AttestationJobQueue } from "../services/attestation-queue.js";
import type { EventStore } from "../services/event-store.js";
import type { TypeBoxFastify } from "./types.js";
import { EmptyQuery, ErrorResponse, Pubkey } from "./schemas.js";

declare module "fastify" { interface FastifyRequest { rawBody: Buffer | null } }

const NormalizedEvent = Type.Object({
  eventId: Type.String({ minLength: 1, maxLength: 200 }),
  eventType: Type.String({ minLength: 1, maxLength: 100 }),
  occurredAt: Type.String({ format: "date-time" }),
  owner: Type.Optional(Pubkey),
  level: Type.Optional(Type.Integer({ minimum: 0, maximum: 255 })),
  expiresAt: Type.Optional(Type.String({ pattern: "^[0-9]+$", maxLength: 20 })),
  attestationHash: Type.Optional(Type.String({ pattern: "^[0-9a-fA-F]{64}$" })),
}, { additionalProperties: false });
const Accepted = Type.Object({ accepted: Type.Boolean(), duplicate: Type.Boolean() }, { additionalProperties: false });
const WebhookHeaders = Type.Object({}, { additionalProperties: true });

function verifySignature(config: ApiConfig, request: { headers: Record<string, string | string[] | undefined>; rawBody: Buffer | null }): void {
  if (!config.webhookSecret) throw new ApiError(503, "webhook_not_configured", "Webhook verification is not configured");
  const signatureHeader = request.headers[config.webhookSignatureHeader];
  const timestampHeader = request.headers[config.webhookTimestampHeader];
  const signature = typeof signatureHeader === "string" ? signatureHeader : "";
  const timestamp = typeof timestampHeader === "string" ? timestampHeader : "";
  if (!request.rawBody || !/^[0-9]{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) throw new ApiError(401, "webhook_signature_invalid", "The webhook signature is invalid");
  const sentAt = Number(timestamp);
  const current = Math.floor(Date.now() / 1000);
  if (Math.abs(current - sentAt) > 300) throw new ApiError(401, "webhook_replay_rejected", "The webhook timestamp is outside the accepted window");
  const expected = createHmac("sha256", config.webhookSecret).update(timestamp).update(".").update(request.rawBody).digest();
  const received = Buffer.from(signature, "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new ApiError(401, "webhook_signature_invalid", "The webhook signature is invalid");
}

export async function registerWebhookRoutes(app: TypeBoxFastify, deps: { config: ApiConfig; events: EventStore; attestations: AttestationJobQueue }): Promise<void> {
  const handler = (kind: "kyc" | "onramp") => async (request: any) => {
    verifySignature(deps.config, request);
    const event = request.body as typeof NormalizedEvent.static;
    if (kind === "kyc" && event.eventType === "kyc.approved") {
      if (!event.owner || event.level === undefined || !event.expiresAt || !event.attestationHash) throw new ApiError(400, "webhook_event_invalid", "An approved KYC event requires owner, level, expiration, and attestation hash");
      try { new PublicKey(event.owner); } catch { throw new ApiError(400, "webhook_event_invalid", "The KYC event owner is invalid"); }
    }
    const claimed = await deps.events.claim(`${kind}:${event.eventId}`);
    if (!claimed) return { accepted: true, duplicate: true };
    if (kind === "kyc" && event.eventType === "kyc.approved") {
      try { await deps.attestations.enqueue({ owner: event.owner!, level: event.level!, expiresAt: event.expiresAt!, attestationHash: event.attestationHash! }); }
      catch { await deps.events.release(`${kind}:${event.eventId}`); throw new ApiError(503, "attestation_queue_unavailable", "The attestation job queue is unavailable"); }
    }
    return { accepted: true, duplicate: false };
  };
  app.post("/v1/webhooks/kyc", { bodyLimit: 256 * 1024, schema: { body: NormalizedEvent, querystring: EmptyQuery, headers: WebhookHeaders, response: { 202: Accepted, 400: ErrorResponse, 401: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse } } }, async (request, reply) => reply.code(202).send(await handler("kyc")(request)));
  app.post("/v1/webhooks/onramp", { bodyLimit: 256 * 1024, schema: { body: NormalizedEvent, querystring: EmptyQuery, headers: WebhookHeaders, response: { 202: Accepted, 400: ErrorResponse, 401: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse } } }, async (request, reply) => reply.code(202).send(await handler("onramp")(request)));
}
