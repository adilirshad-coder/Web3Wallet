import { Type } from "@sinclair/typebox";
import type { AuthService } from "../services/auth.js";
import type { TypeBoxFastify } from "./types.js";
import { EmptyQuery, ErrorResponse, Pubkey } from "./schemas.js";

const ChallengeRequest = Type.Object({ owner: Pubkey }, { additionalProperties: false });
const VerifyRequest = Type.Object({ owner: Pubkey, signature: Type.String({ format: "signatureBase64" }) }, { additionalProperties: false });
const ChallengeResponse = Type.Object({ nonce: Type.String(), message: Type.String(), expiresAt: Type.String({ format: "date-time" }) }, { additionalProperties: false });
const VerifyResponse = Type.Object({ token: Type.String(), expiresAt: Type.String({ format: "date-time" }) }, { additionalProperties: false });

export async function registerAuthRoutes(app: TypeBoxFastify, auth: AuthService): Promise<void> {
  app.post("/v1/auth/challenge", { schema: { body: ChallengeRequest, querystring: EmptyQuery, response: { 200: ChallengeResponse, 400: ErrorResponse, 429: ErrorResponse } } }, async (request) => auth.challenge(request.body.owner));
  app.post("/v1/auth/verify", { schema: { body: VerifyRequest, querystring: EmptyQuery, response: { 200: VerifyResponse, 400: ErrorResponse, 401: ErrorResponse, 429: ErrorResponse } } }, async (request) => auth.verify(request.body.owner, request.body.signature));
}
