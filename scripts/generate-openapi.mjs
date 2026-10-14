import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildApp } from "../api/dist/app.js";
import { loadConfig } from "../api/dist/config.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = loadConfig({ CLUSTER: "localnet", RPC_URL: "http://127.0.0.1:8899", SUBMIT_ENABLED: "false" });
const rpc = {
  async ping() {},
  async getConfig() { return { programId: config.programId.toBase58(), cluster: config.cluster, feeBps: 25, maxFeeBps: 100, maxSlippageBps: 500, paused: false, treasury: config.programId.toBase58(), rentExemptMinZeroData: "890880" }; },
  async getWallet() { return { exists: false, walletPda: config.programId.toBase58(), solVault: config.programId.toBase58(), verification: { status: "unverified", level: 0, expiresAt: null }, createdAt: null }; },
  async getBalances() { return { sol: { lamports: "0", uiAmountString: "0" }, tokens: [] }; },
  async getReceive() { return { solVault: config.programId.toBase58() }; },
};
const txBuilder = { async build() { throw new Error("OpenAPI generation does not execute builders"); } };
const app = await buildApp({ config, rpc, txBuilder, logger: false });
try {
  await app.ready();
  const openapi = app.swagger();
  await fs.writeFile(path.join(root, "api/openapi.json"), `${JSON.stringify(openapi, null, 2)}\n`);
} finally {
  await app.close();
}
