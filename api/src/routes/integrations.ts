import { PublicKey } from "@solana/web3.js";
import { Type } from "@sinclair/typebox";
import type { ApiConfig } from "../config.js";
import { ApiError } from "../errors.js";
import type { AuthService } from "../services/auth.js";
import { executeIdempotent, type IdempotencyStore } from "../services/idempotency.js";
import { deriveIdlPda } from "../program/pda.js";
import { walletIdl } from "../program/idl.js";
import type { TypeBoxFastify } from "./types.js";
import { EmptyQuery, ErrorResponse } from "./schemas.js";

export interface KycProvider { createSession(owner: PublicKey): Promise<unknown> }
export interface OnRampSessions { createSession(input: { owner: PublicKey; destination: PublicKey; asset: "SOL" | "USDC"; idempotencyKey: string }): Promise<unknown> }
declare module "fastify" { interface FastifyRequest { authOwner: string | null } }
const EmptyBody = Type.Object({}, { additionalProperties: false });
const IdempotencyHeaders = Type.Object({ "idempotency-key": Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }, { additionalProperties: true });

export async function registerIntegrationRoutes(app: TypeBoxFastify, deps: { auth: AuthService; idempotency: IdempotencyStore; config: ApiConfig; kyc?: KycProvider; onramp?: OnRampSessions }): Promise<void> {
  app.decorateRequest("authOwner", null);
  const authenticate = async (request: any) => {
    const authorization = request.headers.authorization;
    const match = typeof authorization === "string" ? /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(authorization) : null;
    if (!match) throw new ApiError(401, "session_invalid", "A valid bearer session is required");
    request.authOwner = await deps.auth.authenticate(match[1]);
  };
  app.post("/v1/verification/session", { preHandler: authenticate, schema: { body: EmptyBody, querystring: EmptyQuery, headers: IdempotencyHeaders, response: { 200: Type.Unknown(), 400: ErrorResponse, 401: ErrorResponse, 429: ErrorResponse, 501: ErrorResponse } } }, async (request) => {
    const owner = request.authOwner;
    if (!owner) throw new ApiError(401, "session_invalid", "A valid bearer session is required");
    return executeIdempotent(deps.idempotency, `kyc:${owner}`, request.headers["idempotency-key"], request.body, async () => {
      if (!deps.kyc) throw new ApiError(501, "kyc_provider_not_configured", "KYC sessions are not configured");
      return deps.kyc.createSession(new PublicKey(owner));
    });
  });
  app.post("/v1/onramp/sessions", { preHandler: authenticate, schema: { body: EmptyBody, querystring: EmptyQuery, headers: IdempotencyHeaders, response: { 200: Type.Unknown(), 400: ErrorResponse, 401: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse } } }, async (request) => {
    const owner = request.authOwner;
    if (!owner) throw new ApiError(401, "session_invalid", "A valid bearer session is required");
    return executeIdempotent(deps.idempotency, `onramp:${owner}`, request.headers["idempotency-key"], request.body, async () => {
      if (!deps.onramp) throw new ApiError(503, "onramp_unavailable", "Fiat on-ramp is not available");
      const solVault = deriveIdlPda(walletIdl, "create_wallet", "sol_vault", { owner: new PublicKey(owner) }, deps.config.programId);
      return deps.onramp.createSession({ owner: new PublicKey(owner), destination: solVault, asset: "SOL", idempotencyKey: request.headers["idempotency-key"]! });
    });
  });
}
