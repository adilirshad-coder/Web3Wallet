import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import { FormatRegistry } from "@sinclair/typebox";
import { loadConfig } from "../../api/dist/config.js";
import { ApiError } from "../../api/dist/errors.js";
import { registerSwapRoutes } from "../../api/dist/routes/swap.js";

test("Devnet Jupiter quote is rejected before any provider request", async (t) => {
  const app = Fastify({ logger: false });
  FormatRegistry.Set("base58", (value) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));
  app.setValidatorCompiler(TypeBoxValidatorCompiler);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: "test-request" },
      });
    }
    return reply.send(error);
  });
  const config = loadConfig({
    CLUSTER: "devnet",
    JUPITER_API_KEY: "unit-test-only",
    SUBMIT_ENABLED: "false",
  });
  await registerSwapRoutes(app, config);
  t.after(() => app.close());

  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("Devnet must not contact Jupiter");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await app.inject({
    method: "POST",
    url: "/v1/swap/quote",
    payload: {
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1",
      taker: "11111111111111111111111111111111",
    },
  });

  assert.equal(response.statusCode, 501);
  assert.equal(response.json().error.code, "swap_network_unsupported");
  assert.equal(providerCalls, 0);
});
