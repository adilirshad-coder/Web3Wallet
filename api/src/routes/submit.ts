import { Type } from "@sinclair/typebox";
import type { IdempotencyStore } from "../services/idempotency.js";
import { executeIdempotent } from "../services/idempotency.js";
import type { SubmitService } from "../services/submit.js";
import type { TypeBoxFastify } from "./types.js";
import { EmptyQuery, ErrorResponse } from "./schemas.js";

const SubmitRequest = Type.Object({ signedTransaction: Type.String({ format: "base64Transaction", maxLength: 1644 }) }, { additionalProperties: false });
const SubmitResponse = Type.Object({ signature: Type.String({ format: "base58Signature" }) }, { additionalProperties: false });
const SignatureParams = Type.Object({ signature: Type.String({ format: "base58Signature", minLength: 80, maxLength: 90 }) }, { additionalProperties: false });
const StatusResponse = Type.Object({ status: Type.Union([Type.Literal("processed"), Type.Literal("confirmed"), Type.Literal("finalized"), Type.Literal("failed"), Type.Literal("not_found")]), error: Type.Optional(Type.String()) }, { additionalProperties: false });
const IdempotencyHeaders = Type.Object({ "idempotency-key": Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }, { additionalProperties: true });

export async function registerSubmitRoutes(app: TypeBoxFastify, deps: { submit: SubmitService; idempotency: IdempotencyStore }): Promise<void> {
  app.post("/v1/tx/submit", { schema: { body: SubmitRequest, querystring: EmptyQuery, headers: IdempotencyHeaders, response: { 200: SubmitResponse, 400: ErrorResponse, 409: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 501: ErrorResponse, 503: ErrorResponse } } }, async (request) => {
    return executeIdempotent(deps.idempotency, "tx-submit", request.headers["idempotency-key"], request.body, () => deps.submit.submit(request.body.signedTransaction));
  });
  app.get("/v1/tx/:signature", { schema: { params: SignatureParams, querystring: EmptyQuery, response: { 200: StatusResponse, 400: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse } } }, async (request) => deps.submit.status(request.params.signature));
}
