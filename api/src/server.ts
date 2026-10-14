import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createRpcService } from "./services/rpc.js";
import { createTransactionBuilder } from "./services/tx-builder.js";
import { LocalKeypairSigner } from "./services/verifier-signer.js";
import { MemoryAttestationJobQueue, NullAttestationJobQueue } from "./services/attestation-queue.js";

const config = loadConfig();
const verifierPath = process.env.VERIFIER_KEYPAIR_PATH;
const attestations = verifierPath
  ? new MemoryAttestationJobQueue(LocalKeypairSigner.fromPath(verifierPath, config))
  : new NullAttestationJobQueue();
const app = await buildApp({ config, rpc: createRpcService(config), txBuilder: createTransactionBuilder(config), attestations });
const address = await app.listen({ host: config.host, port: config.port });
app.log.info({ address }, "wallet API listening");

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down wallet API");
  try { await app.close(); process.exitCode = 0; }
  catch (error) { app.log.error({ err: error }, "shutdown failed"); process.exitCode = 1; }
}
process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
