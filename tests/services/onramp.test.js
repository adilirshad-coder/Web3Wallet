import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import {
  GatedOnRampService,
  OnRampUnavailableError,
} from "../../services/dist/onramp.js";

const owner = Keypair.fromSeed(Buffer.alloc(32, 21)).publicKey;
const destination = Keypair.fromSeed(Buffer.alloc(32, 22)).publicKey;
const activeVerification = { status: "verified", expiresAtUnixSeconds: 2_000 };

function fixture({ verification = activeVerification, confirmed = true } = {}) {
  const providerCalls = [];
  const service = new GatedOnRampService(
    async (requestedOwner) => {
      assert(requestedOwner.equals(owner));
      return verification;
    },
    {
      async createSession(input) {
        providerCalls.push(input);
        return { providerSessionId: "session-1", redirectUrl: "https://provider.invalid/session-1" };
      },
    },
    confirmed,
  );
  return { service, providerCalls };
}

const request = (overrides = {}) => ({
  owner,
  destination,
  asset: "USDC",
  idempotencyKey: "request-123",
  nowUnixSeconds: 1_000,
  ...overrides,
});

test("provider delivery gate blocks calls before verification or provider access", async () => {
  const { service, providerCalls } = fixture({ confirmed: false });
  await assert.rejects(service.createSession(request()), OnRampUnavailableError);
  assert.deepEqual(providerCalls, []);
});

test("creates a session for an active verified wallet and forwards the idempotency key", async () => {
  const { service, providerCalls } = fixture();
  const result = await service.createSession(request());

  assert.deepEqual(result, {
    providerSessionId: "session-1",
    redirectUrl: "https://provider.invalid/session-1",
  });
  assert.deepEqual(providerCalls, [{
    destination: destination.toBase58(),
    network: "solana",
    asset: "USDC",
    idempotencyKey: "request-123",
  }]);
});

test("rejects missing, expired, or non-verified attestations without provider calls", async (t) => {
  const cases = [
    { name: "pending", verification: { status: "pending", expiresAtUnixSeconds: 2_000 } },
    { name: "expired", verification: { status: "verified", expiresAtUnixSeconds: 1_000 } },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const { service, providerCalls } = fixture(item);
      await assert.rejects(service.createSession(request()), /active verified attestation/);
      assert.deepEqual(providerCalls, []);
    });
  }
});

test("requires a non-empty idempotency key before contacting the provider", async () => {
  const { service, providerCalls } = fixture();
  await assert.rejects(service.createSession(request({ idempotencyKey: "  " })), /idempotency key/);
  assert.deepEqual(providerCalls, []);
});
