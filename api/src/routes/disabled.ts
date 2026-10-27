import { ApiError } from "../errors.js";
import { EmptyQuery, ErrorResponse } from "./schemas.js";
import { Type } from "@sinclair/typebox";
import type { TypeBoxFastify } from "./types.js";

export async function registerDisabledRoutes(app: TypeBoxFastify): Promise<void> {
  const empty = Type.Object({}, { additionalProperties: false });
  app.post("/v1/swap/quote", { schema: { body: empty, querystring: EmptyQuery, response: { 400: ErrorResponse, 429: ErrorResponse, 501: ErrorResponse } } }, async () => { throw new ApiError(501, "swap_unavailable", "Swap is not available"); });
  app.post("/v1/tx/swap", { schema: { body: empty, querystring: EmptyQuery, response: { 400: ErrorResponse, 429: ErrorResponse, 501: ErrorResponse } } }, async () => { throw new ApiError(501, "swap_unavailable", "Swap is not available"); });
}
