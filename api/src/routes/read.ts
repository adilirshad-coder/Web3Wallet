import { PublicKey } from "@solana/web3.js";
import type { ApiConfig } from "../config.js";
import type { RpcService } from "../services/rpc.js";
import { calculateFee } from "@web3wallet/sdk";
import { ApiError } from "../errors.js";
import { BalancesResponse, ConfigResponse, EmptyQuery, ErrorResponse, FeeRequest, FeeResponse, MintQuery, OwnerParams, ReceiveResponse, WalletResponse } from "./schemas.js";
import type { TypeBoxFastify } from "./types.js";

export async function registerReadRoutes(app: TypeBoxFastify, deps: { config: ApiConfig; rpc: RpcService }): Promise<void> {
  app.get("/v1/config", { schema: { querystring: EmptyQuery, response: { 200: ConfigResponse, 429: ErrorResponse, 500: ErrorResponse, 503: ErrorResponse } } }, async () => deps.rpc.getConfig());
  app.get("/v1/wallets/:owner", { schema: { params: OwnerParams, querystring: EmptyQuery, response: { 200: WalletResponse, 400: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse } } }, async (request) => {
    const result = await deps.rpc.getWallet(new PublicKey(request.params.owner));
    if (!result.exists) throw new ApiError(404, "wallet_not_found", "The wallet was not found");
    return result;
  });
  app.get("/v1/wallets/:owner/balances", { schema: { params: OwnerParams, querystring: EmptyQuery, response: { 200: BalancesResponse, 400: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse } } }, async (request) => deps.rpc.getBalances(new PublicKey(request.params.owner)));
  app.get("/v1/wallets/:owner/receive", { schema: { params: OwnerParams, querystring: MintQuery, response: { 200: ReceiveResponse, 400: ErrorResponse, 404: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse } } }, async (request) => {
    return deps.rpc.getReceive(new PublicKey(request.params.owner), request.query.mint ? new PublicKey(request.query.mint) : undefined);
  });
  app.post("/v1/quotes/fee", { schema: { body: FeeRequest, querystring: EmptyQuery, response: { 200: FeeResponse, 400: ErrorResponse, 422: ErrorResponse, 429: ErrorResponse, 503: ErrorResponse } } }, async (request) => {
    const config = await deps.rpc.getConfig();
    return calculateFee(request.body.amount, config.feeBps);
  });
}
