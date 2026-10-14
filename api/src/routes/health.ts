import type { RpcService } from "../services/rpc.js";
import { Type } from "@sinclair/typebox";
import type { TypeBoxFastify } from "./types.js";
import { EmptyQuery, ErrorResponse } from "./schemas.js";

const Healthy = Type.Object({ status: Type.Literal("ok") }, { additionalProperties: false });
const Ready = Type.Object({ status: Type.Union([Type.Literal("ready"), Type.Literal("not_ready")]) }, { additionalProperties: false });

export async function registerHealthRoutes(app: TypeBoxFastify, rpc: RpcService): Promise<void> {
  app.get("/healthz", { schema: { querystring: EmptyQuery, response: { 200: Healthy, 429: ErrorResponse } } }, async () => ({ status: "ok" as const }));
  app.get("/readyz", { schema: { querystring: EmptyQuery, response: { 200: Ready, 429: ErrorResponse, 503: Ready } } }, async (_request, reply) => {
    try { await rpc.ping(); await rpc.getConfig(); return { status: "ready" as const }; }
    catch { return reply.code(503).send({ status: "not_ready" as const }); }
  });
}
