import type { TransactionBuilderService } from "../services/tx-builder.js";
import type { TypeBoxFastify } from "./types.js";
import { BuiltTransactionResponse, CreateWalletRequest, EmptyQuery, ErrorResponse, RequestVerificationRequest, SendSolRequest, SendTokenRequest } from "./schemas.js";

export async function registerTransactionRoutes(app: TypeBoxFastify, builder: TransactionBuilderService): Promise<void> {
  const responses = { 200: BuiltTransactionResponse, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse };
  app.post("/v1/tx/create-wallet", { schema: { body: CreateWalletRequest, querystring: EmptyQuery, response: responses } }, async (request) => builder.build("create-wallet", request.body));
  app.post("/v1/tx/send-sol", { schema: { body: SendSolRequest, querystring: EmptyQuery, response: responses } }, async (request) => builder.build("send-sol", request.body));
  app.post("/v1/tx/send-token", { schema: { body: SendTokenRequest, querystring: EmptyQuery, response: responses } }, async (request) => builder.build("send-token", request.body));
  app.post("/v1/tx/request-verification", { schema: { body: RequestVerificationRequest, querystring: EmptyQuery, response: responses } }, async (request) => builder.build("request-verification", request.body));
}
