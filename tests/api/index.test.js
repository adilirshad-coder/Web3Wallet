import assert from "node:assert/strict";
import test from "node:test";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { Program } from "@anchor-lang/core";
import { buildApp } from "../../api/dist/app.js";
import { loadConfig } from "../../api/dist/config.js";
import { createAuthService } from "../../api/dist/services/auth.js";
import { MemoryIdempotencyStore, executeIdempotent } from "../../api/dist/services/idempotency.js";
import nacl from "tweetnacl";
import { createHmac } from "node:crypto";
import { MemoryEventStore } from "../../api/dist/services/event-store.js";
import { assertAllowedTransaction } from "../../api/dist/services/submit.js";
import { walletIdl } from "../../api/dist/program/idl.js";
import { walletErrorMapIsComplete, mapWalletError } from "../../api/dist/program/error-map.js";
import { encodeBase58 } from "../../api/dist/program/base58.js";
import { LocalKeypairSigner } from "../../api/dist/services/verifier-signer.js";
import { deriveIdlPda } from "../../api/dist/program/pda.js";
import fs from "node:fs";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { createTransactionBuilder } from "../../api/dist/services/tx-builder.js";

const owner = Keypair.fromSeed(Buffer.alloc(32, 21)).publicKey;
const mint = Keypair.fromSeed(Buffer.alloc(32, 22)).publicKey;
const config = loadConfig({ RPC_URL: "http://127.0.0.1:8899", CLUSTER: "test" });
const rpc = {
  async ping() {},
  async getConfig() { return { programId: config.programId.toBase58(), cluster: config.cluster, feeBps: 25, maxFeeBps: 500, maxSlippageBps: 1000, paused: false, treasury: owner.toBase58(), rentExemptMinZeroData: "890880" }; },
  async getWallet(key) { return { exists: true, walletPda: key.toBase58(), solVault: owner.toBase58(), verification: { status: "unverified", level: 0, expiresAt: null }, createdAt: "1700000000" }; },
  async getBalances() { return { sol: { lamports: "1000000000", uiAmountString: "1" }, tokens: [{ mint: mint.toBase58(), tokenProgram: owner.toBase58(), tokenAccount: owner.toBase58(), rawAmount: "1234567", decimals: 6, uiAmountString: "1.234567" }] }; },
  async getReceive(_key, selectedMint) { return selectedMint ? { solVault: owner.toBase58(), ata: mint.toBase58(), mint: selectedMint.toBase58(), tokenProgram: owner.toBase58() } : { solVault: owner.toBase58() }; },
};
const builtTx = {
  transaction: "AA==", encoding: "base64", version: 0, blockhash: owner.toBase58(), lastValidBlockHeight: 100,
  feePayer: owner.toBase58(), instructions: [{ programId: config.programId.toBase58(), name: "create_wallet" }],
  simulation: { unitsConsumed: 25_000 },
  cost: { networkFeeLamports: "5000", rentLamports: "1000000", protocolFee: { amount: "0", mint: null } }, warnings: [],
};
const txBuilder = { async build(kind, request) { return { ...builtTx, instructions: [{ ...builtTx.instructions[0], name: kind, requestOwner: request.owner }] }; } };

test("API defaults to Devnet, the existing program identity, and disabled submission", () => {
  const defaults = loadConfig({});
  assert.equal(defaults.cluster, "devnet");
  assert.equal(defaults.rpcUrl, "https://api.devnet.solana.com/");
  assert.equal(defaults.programId.toBase58(), "6equ7Y765rc9GYw8wKV5dW5odG8RPtfbExvU4ovtQz7u");
  assert.equal(defaults.submitEnabled, false);
});

function makeBuilderHarness({ ownerKey = Keypair.fromSeed(Buffer.alloc(32, 61)), configPatch = {}, accountInfo = () => null, tokenBalance = { value: { amount: "100000000", decimals: 6 } }, simulationError = null, simulationLogs = [] } = {}) {
  const rpcConfig = { programId: config.programId.toBase58(), cluster: config.cluster, feeBps: 25, maxFeeBps: 500, maxSlippageBps: 1000, paused: false, treasury: owner.toBase58(), rentExemptMinZeroData: "890880", ...configPatch };
  const simulations = [];
  const fakeConnection = {
    async getLatestBlockhash() { return { blockhash: Keypair.fromSeed(Buffer.alloc(32, 62)).publicKey.toBase58(), lastValidBlockHeight: 1000 }; },
    async getMinimumBalanceForRentExemption() { return 890880; },
    async getAccountInfo(key) { return accountInfo(key); },
    async getTokenAccountBalance() { return tokenBalance; },
    async getRecentPrioritizationFees() { return [{ slot: 1, prioritizationFee: 500 }]; },
    async simulateTransaction(transaction, options) { simulations.push({ transaction, options }); return { context: { slot: 1 }, value: { err: simulationError, logs: simulationLogs, unitsConsumed: 100000 } }; },
    async getFeeForMessage() { return { context: { slot: 1 }, value: 5000 }; },
  };
  const realProgram = new Program(walletIdl, { connection: fakeConnection });
  const walletExists = configPatch.walletExists ?? true;
  const program = { methods: realProgram.methods, coder: realProgram.coder, account: { userWallet: { async fetchNullable() { return walletExists ? {} : null; } } } };
  const fakeRpc = { async getConfig() { return rpcConfig; } };
  const builder = createTransactionBuilder({ ...config, programId: new PublicKey(rpcConfig.programId) }, { connection: fakeConnection, program, rpc: fakeRpc });
  return { builder, owner: ownerKey, connection: fakeConnection, simulations, rpcConfig, coder: realProgram.coder };
}

test("read routes return schema-valid responses", async (t) => {
  const app = await buildApp({ config, rpc, txBuilder, logger: false });
  t.after(() => app.close());
  const cases = [
    ["GET", "/healthz", undefined, 200],
    ["GET", "/readyz", undefined, 200],
    ["GET", "/v1/config", undefined, 200],
    ["GET", `/v1/wallets/${owner}`, undefined, 200],
    ["GET", `/v1/wallets/${owner}/balances`, undefined, 200],
    ["GET", `/v1/wallets/${owner}/receive`, undefined, 200],
    ["GET", `/v1/wallets/${owner}/receive?mint=${mint}`, undefined, 200],
    ["POST", "/v1/quotes/fee", { kind: "sol", amount: "10000" }, 200],
    ["POST", "/v1/tx/create-wallet", { owner: owner.toBase58() }, 200],
    ["POST", "/v1/tx/send-sol", { owner: owner.toBase58(), recipient: mint.toBase58(), amount: "1" }, 200],
    ["POST", "/v1/tx/send-token", { owner: owner.toBase58(), recipient: mint.toBase58(), mint: owner.toBase58(), amount: "1" }, 200],
    ["POST", "/v1/tx/request-verification", { owner: owner.toBase58() }, 200],
    ["POST", "/v1/swap/quote", { inputMint: owner.toBase58(), outputMint: mint.toBase58(), amount: "1", taker: owner.toBase58() }, 503],
    ["POST", "/v1/tx/swap", {}, 400],
    ["POST", "/v1/onramp/sessions", {}, 401],
  ];
  for (const [method, url, payload, expected] of cases) {
    const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }), ...(url === "/v1/onramp/sessions" ? { headers: { "idempotency-key": "onramp-key" } } : {}) });
    assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.ok(response.json());
  }
});

test("request schemas reject extra properties, malformed keys, and invalid fee amounts", async (t) => {
  const app = await buildApp({ config, rpc, logger: false });
  t.after(() => app.close());
  for (const url of ["/v1/wallets/not-a-key", `/v1/wallets/${owner}?unexpected=true`]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error.code, "validation_error");
  }
  for (const amount of ["0", "-1", "1.5", "18446744073709551616"]) {
    const response = await app.inject({ method: "POST", url: "/v1/quotes/fee", payload: { kind: "sol", amount } });
    assert.notEqual(response.statusCode, 200, amount);
  }
  const numberAmount = await app.inject({ method: "POST", url: "/v1/quotes/fee", payload: { kind: "sol", amount: 1 } });
  assert.equal(numberAmount.statusCode, 400);
  const unknown = await app.inject({ method: "POST", url: "/v1/quotes/fee", payload: { kind: "sol", amount: "1", extra: true } });
  assert.equal(unknown.statusCode, 400);
});

test("fee quote uses integer ceiling and stable error envelope", async (t) => {
  const app = await buildApp({ config, rpc, logger: false });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/v1/quotes/fee", payload: { kind: "token", amount: "10001" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { amount: "10001", fee: "26", totalDebit: "10027", feeBps: 25, rounding: "ceil" });
  const invalidSwap = await app.inject({ method: "POST", url: "/v1/tx/swap", payload: {} });
  assert.equal(invalidSwap.statusCode, 400);
  assert.equal(invalidSwap.json().error.code, "validation_error");
  assert.ok(invalidSwap.json().error.requestId);
});

test("transaction request schemas reject extra properties and non-string amounts", async (t) => {
  const app = await buildApp({ config, rpc, txBuilder, logger: false });
  t.after(() => app.close());
  const cases = [
    ["/v1/tx/create-wallet", { owner: owner.toBase58(), privateKey: "never" }],
    ["/v1/tx/send-sol", { owner: owner.toBase58(), recipient: mint.toBase58(), amount: 1 }],
    ["/v1/tx/send-token", { owner: owner.toBase58(), mint: owner.toBase58(), recipient: mint.toBase58(), amount: "1", extra: true }],
    ["/v1/tx/request-verification", { owner: owner.toBase58(), secret: "never" }],
  ];
  for (const [url, payload] of cases) {
    const response = await app.inject({ method: "POST", url, payload });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error.code, "validation_error");
  }
});

test("wallet signature challenges are single-use and sessions expire", async () => {
  const keypair = Keypair.fromSeed(Buffer.alloc(32, 40));
  let now = 1_800_000_000_000;
  const auth = createAuthService("test", undefined, () => now);
  const challenge = await auth.challenge(keypair.publicKey.toBase58());
  const signature = Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), keypair.secretKey)).toString("base64");
  const session = await auth.verify(keypair.publicKey.toBase58(), signature);
  assert.equal(await auth.authenticate(session.token), keypair.publicKey.toBase58());
  await assert.rejects(auth.verify(keypair.publicKey.toBase58(), signature), { code: "challenge_invalid" });
  now += 16 * 60_000;
  await assert.rejects(auth.authenticate(session.token), { code: "session_invalid" });
});

test("wrong and expired wallet challenge signatures fail", async () => {
  const keypair = Keypair.fromSeed(Buffer.alloc(32, 41));
  let now = 1_800_000_000_000;
  const auth = createAuthService("test", undefined, () => now);
  const challenge = await auth.challenge(keypair.publicKey.toBase58());
  const wrong = Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), Keypair.fromSeed(Buffer.alloc(32, 42)).secretKey)).toString("base64");
  await assert.rejects(auth.verify(keypair.publicKey.toBase58(), wrong), { code: "invalid_signature" });
  await auth.challenge(keypair.publicKey.toBase58());
  now += 5 * 60_000;
  await assert.rejects(auth.verify(keypair.publicKey.toBase58(), Buffer.alloc(64).toString("base64")), { code: "challenge_expired" });
});

test("idempotency repeats the same result and rejects body conflicts", async () => {
  const store = new MemoryIdempotencyStore();
  let calls = 0;
  const run = () => executeIdempotent(store, "test", "same-key", { a: 1 }, async () => { calls += 1; return { accepted: true }; });
  assert.deepEqual(await run(), { accepted: true });
  assert.deepEqual(await run(), { accepted: true });
  assert.equal(calls, 1);
  await assert.rejects(executeIdempotent(store, "test", "same-key", { a: 2 }, async () => ({})), { code: "idempotency_conflict" });
});

test("webhooks validate HMAC and replay window, deduplicate events, and enqueue approval once", async (t) => {
  const secret = "test-webhook-secret";
  const webhookConfig = { ...config, webhookSecret: secret };
  const events = new MemoryEventStore();
  const queued = [];
  const app = await buildApp({ config: webhookConfig, rpc, txBuilder, events, attestations: { async enqueue(event) { queued.push(event); } }, logger: false });
  t.after(() => app.close());
  const body = {
    eventId: "evt-001", eventType: "kyc.approved", occurredAt: new Date().toISOString(),
    owner: owner.toBase58(), level: 2, expiresAt: "1900000000", attestationHash: "ab".repeat(32),
  };
  const raw = JSON.stringify(body);
  const signed = (timestamp) => createHmac("sha256", secret).update(String(timestamp)).update(".").update(raw).digest("hex");
  const now = Math.floor(Date.now() / 1000);
  const headers = (timestamp, signature = signed(timestamp)) => ({ "content-type": "application/json", "x-wallet-timestamp": String(timestamp), "x-wallet-signature": signature });
  const invalid = await app.inject({ method: "POST", url: "/v1/webhooks/kyc", headers: headers(now, "00".repeat(32)), payload: raw });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.json().error.code, "webhook_signature_invalid");
  const replay = await app.inject({ method: "POST", url: "/v1/webhooks/kyc", headers: headers(now - 301), payload: raw });
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().error.code, "webhook_replay_rejected");
  const accepted = await app.inject({ method: "POST", url: "/v1/webhooks/kyc", headers: headers(now), payload: raw });
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.json().duplicate, false);
  const duplicate = await app.inject({ method: "POST", url: "/v1/webhooks/kyc", headers: headers(now), payload: raw });
  assert.equal(duplicate.statusCode, 202);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].owner, owner.toBase58());
});

test("submit allowlist rejects foreign instructions, wrong fee payer, oversized and unsigned transactions", () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 51));
  const other = Keypair.fromSeed(Buffer.alloc(32, 52));
  const program = new Program(walletIdl, { connection: new Connection("http://127.0.0.1:8899") });
  const data = program.coder.instruction.encode("createWallet", {});
  const walletInstruction = (ownerKey) => new TransactionInstruction({
    programId: config.programId,
    keys: [{ pubkey: ownerKey, isSigner: true, isWritable: true }],
    data,
  });
  const makeTx = (instructions, feePayer) => new VersionedTransaction(new TransactionMessage({
    payerKey: feePayer.publicKey, recentBlockhash: owner.toBase58(), instructions,
  }).compileToV0Message());
  const valid = makeTx([walletInstruction(payer.publicKey)], payer);
  valid.sign([payer]);
  const decode = (instructionData) => program.coder.instruction.decode(instructionData);
  assert.equal(assertAllowedTransaction(valid, valid.serialize().length, config.programId, decode).toBase58(), payer.publicKey.toBase58());

  const foreign = makeTx([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: other.publicKey, lamports: 1 })], payer);
  foreign.sign([payer]);
  assert.throws(() => assertAllowedTransaction(foreign, foreign.serialize().length, config.programId, decode), { code: "instruction_not_allowed" });

  const wrongPayer = makeTx([walletInstruction(other.publicKey)], payer);
  wrongPayer.sign([payer, other]);
  assert.throws(() => assertAllowedTransaction(wrongPayer, wrongPayer.serialize().length, config.programId, decode), { code: "fee_payer_invalid" });
  assert.throws(() => assertAllowedTransaction(valid, 1233, config.programId, decode), { code: "transaction_size_invalid" });
  const unsigned = makeTx([walletInstruction(payer.publicKey)], payer);
  assert.throws(() => assertAllowedTransaction(unsigned, unsigned.serialize().length, config.programId, decode), { code: "signature_missing" });
});

test("every WalletError in the checked-in IDL has a stable API mapping", () => {
  assert.equal(walletErrorMapIsComplete(), true);
  assert.equal(mapWalletError(6002).code, "invalid_recipient");
  assert.equal(mapWalletError(6015).statusCode, 501);
  assert.equal(mapWalletError(9999), undefined);
});

test("API IDL matches the freshly generated target IDL", () => {
  const apiIdl = JSON.parse(fs.readFileSync(new URL("../../api/idl/wallet.json", import.meta.url), "utf8"));
  const targetIdl = JSON.parse(fs.readFileSync(new URL("../../target/idl/wallet.json", import.meta.url), "utf8"));
  assert.deepEqual(apiIdl, targetIdl);
});

test("submit route requires an idempotency key and replays the same response", async (t) => {
  let submissions = 0;
  const signature = encodeBase58(Uint8Array.from({ length: 64 }, () => 7));
  const app = await buildApp({ config, rpc, txBuilder, submit: { async submit() { submissions += 1; return { signature }; }, async status() { return { status: "confirmed" }; } }, idempotency: new MemoryIdempotencyStore(), logger: false });
  t.after(() => app.close());
  const missing = await app.inject({ method: "POST", url: "/v1/tx/submit", payload: { signedTransaction: "AA==" } });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "idempotency_key_required");
  const send = (signedTransaction) => app.inject({ method: "POST", url: "/v1/tx/submit", headers: { "idempotency-key": "submit-1" }, payload: { signedTransaction } });
  const first = await send("AA==");
  const second = await send("AA==");
  assert.equal(first.statusCode, 200);
  assert.deepEqual(second.json(), first.json());
  assert.equal(submissions, 1);
  const conflict = await send("AQ==");
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, "idempotency_conflict");
});

test("unexpected RPC errors return a redacted envelope without stack or URL", async (t) => {
  const brokenRpc = { ...rpc, async getConfig() { throw new Error("request to https://private-rpc.example/key failed"); } };
  const app = await buildApp({ config, rpc: brokenRpc, txBuilder, logger: false });
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/v1/config" });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.code, "internal_error");
  assert.ok(response.json().error.requestId);
  assert.equal(response.body.includes("private-rpc.example"), false);
  assert.equal(response.body.includes("stack"), false);
});

test("non-JSON request content types receive a stable 415 envelope", async (t) => {
  const app = await buildApp({ config, rpc, txBuilder, logger: false });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/v1/quotes/fee", headers: { "content-type": "text/plain" }, payload: "not json" });
  assert.equal(response.statusCode, 415);
  assert.equal(response.json().error.code, "unsupported_media_type");
});

test("local verifier signer refuses startup on mainnet-beta", () => {
  assert.throws(() => LocalKeypairSigner.fromPath("not-read-on-mainnet.json", { ...config, cluster: "mainnet-beta" }), /not allowed on mainnet-beta/);
});

test("wallet-specific limiter returns 429 after the configured per-owner threshold", async (t) => {
  const app = await buildApp({ config, rpc, txBuilder, logger: false });
  t.after(() => app.close());
  let final;
  for (let i = 0; i < 61; i += 1) final = await app.inject({ method: "GET", url: `/v1/wallets/${owner}` });
  assert.equal(final.statusCode, 429);
  assert.equal(final.json().error.code, "rate_limited");
});

test("authenticated on-ramp derives the SOL vault destination and is idempotent", async (t) => {
  const auth = createAuthService("test");
  await auth.store.putSession("test-session-token-which-is-long-enough-123456", { owner: owner.toBase58(), expiresAt: Date.now() + 60_000 });
  const calls = [];
  const idempotency = new MemoryIdempotencyStore();
  const app = await buildApp({
    config, rpc, txBuilder, auth, idempotency, logger: false,
    onramp: { async createSession(input) { calls.push(input); return { providerSessionId: "session-1", redirectUrl: "https://provider.invalid" }; } },
  });
  t.after(() => app.close());
  const headers = { authorization: "Bearer test-session-token-which-is-long-enough-123456", "idempotency-key": "onramp-1" };
  const first = await app.inject({ method: "POST", url: "/v1/onramp/sessions", headers, payload: {} });
  const second = await app.inject({ method: "POST", url: "/v1/onramp/sessions", headers, payload: {} });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(second.json(), first.json());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].destination.toBase58(), deriveIdlPda(walletIdl, "create_wallet", "sol_vault", { owner }, config.programId).toBase58());
});

test("create-wallet builder returns an unsigned IDL transaction with compute budget and simulation", async () => {
  const harness = makeBuilderHarness({ configPatch: { walletExists: false } });
  const built = await harness.builder.build("create-wallet", { owner: harness.owner.publicKey.toBase58() });
  const transaction = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
  const instructions = transaction.message.compiledInstructions;
  const programIds = instructions.map((instruction) => transaction.message.staticAccountKeys[instruction.programIdIndex]);
  assert.deepEqual(programIds.slice(0, 2).map((programId) => programId.toBase58()), [ComputeBudgetProgram.programId.toBase58(), ComputeBudgetProgram.programId.toBase58()]);
  assert.deepEqual(instructions.slice(0, 2).map(({ data }) => data[0]), [2, 3]);
  assert.equal(Buffer.from(instructions[0].data).readUInt32LE(1), 120000);
  assert.equal(Buffer.from(instructions[1].data).readBigUInt64LE(1), 500n);
  const walletInstruction = instructions.find((instruction) => transaction.message.staticAccountKeys[instruction.programIdIndex].equals(config.programId));
  const decoded = harness.coder.instruction.decode(Buffer.from(walletInstruction.data));
  assert.equal(decoded.name, "createWallet");
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[0]].toBase58(), harness.owner.publicKey.toBase58());
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[1]].toBase58(), deriveIdlPda(walletIdl, "initialize_config", "config", {}, config.programId).toBase58());
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[2]].toBase58(), deriveIdlPda(walletIdl, "create_wallet", "wallet", { owner: harness.owner.publicKey }, config.programId).toBase58());
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[3]].toBase58(), deriveIdlPda(walletIdl, "create_wallet", "sol_vault", { owner: harness.owner.publicKey }, config.programId).toBase58());
  assert.equal(transaction.message.staticAccountKeys[0].toBase58(), harness.owner.publicKey.toBase58());
  assert.ok(transaction.signatures[0].every((byte) => byte === 0));
  assert.equal(harness.simulations.length, 2);
  assert.equal(harness.simulations[0].options.sigVerify, false);
  assert.equal(harness.simulations[1].options.sigVerify, false);
  assert.equal(built.simulation.unitsConsumed, 100000);
  assert.equal(built.version, 0);
  assert.equal(built.cost.rentLamports, "890880");
});

test("create-wallet builder reports a concurrent wallet creation as an idempotent conflict", async () => {
  const harness = makeBuilderHarness({ configPatch: { walletExists: false }, simulationError: { InstructionError: [2, "AccountAlreadyInitialized"] }, simulationLogs: ["Allocate: account already in use"] });
  await assert.rejects(harness.builder.build("create-wallet", { owner: harness.owner.publicKey.toBase58() }), { statusCode: 409, code: "wallet_already_exists" });
});

test("send-sol builder uses IDL instruction/account order and validates the configured fee", async () => {
  const ownerKey = Keypair.fromSeed(Buffer.alloc(32, 63));
  const recipient = Keypair.fromSeed(Buffer.alloc(32, 64)).publicKey;
  const treasury = owner;
  const vault = deriveIdlPda(walletIdl, "create_wallet", "sol_vault", { owner: ownerKey.publicKey }, config.programId);
  const harness = makeBuilderHarness({ ownerKey, accountInfo: (key) => {
    if (key.equals(vault)) return { lamports: 10_000_000, owner: SystemProgram.programId, data: Buffer.alloc(0) };
    if (key.equals(recipient)) return null;
    if (key.equals(treasury)) return { lamports: 2_000_000, owner: SystemProgram.programId, data: Buffer.alloc(0) };
    return null;
  } });
  const built = await harness.builder.build("send-sol", { owner: ownerKey.publicKey.toBase58(), recipient: recipient.toBase58(), amount: "1000000" });
  const transaction = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
  const compiled = transaction.message.compiledInstructions.find((instruction) => transaction.message.staticAccountKeys[instruction.programIdIndex].equals(config.programId));
  const decoded = harness.coder.instruction.decode(Buffer.from(compiled.data));
  assert.equal(decoded.name, "sendSol");
  assert.equal(decoded.data.amount.toString(), "1000000");
  assert.equal(transaction.message.staticAccountKeys[compiled.accountKeyIndexes[0]].toBase58(), ownerKey.publicKey.toBase58());
  assert.equal(transaction.message.staticAccountKeys[compiled.accountKeyIndexes[4]].toBase58(), recipient.toBase58());
  assert.equal(transaction.message.staticAccountKeys[compiled.accountKeyIndexes[5]].toBase58(), treasury.toBase58());
  const budgetLimit = transaction.message.compiledInstructions[0];
  const budgetPrice = transaction.message.compiledInstructions[1];
  assert.equal(Buffer.from(budgetLimit.data).readUInt32LE(1), 120000);
  assert.equal(Buffer.from(budgetPrice.data).readBigUInt64LE(1), 500n);
  assert.equal(built.cost.protocolFee.amount, "2500");
});

test("send-token prepends recipient and treasury idempotent ATAs and rejects extension mints and paused state", async () => {
  const ownerKey = Keypair.fromSeed(Buffer.alloc(32, 65));
  const recipient = Keypair.fromSeed(Buffer.alloc(32, 66)).publicKey;
  const tokenMint = Keypair.fromSeed(Buffer.alloc(32, 67)).publicKey;
  const walletPda = deriveIdlPda(walletIdl, "create_wallet", "wallet", { owner: ownerKey.publicKey }, config.programId);
  const treasury = owner;
  const walletAta = getAssociatedTokenAddressSync(tokenMint, walletPda, true, TOKEN_2022_PROGRAM_ID);
  const recipientAta = getAssociatedTokenAddressSync(tokenMint, recipient, false, TOKEN_2022_PROGRAM_ID);
  const treasuryAta = getAssociatedTokenAddressSync(tokenMint, treasury, true, TOKEN_2022_PROGRAM_ID);
  const harness = makeBuilderHarness({ ownerKey, accountInfo: (key) => {
    if (key.equals(tokenMint)) return { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(82) };
    if (key.equals(walletAta)) return { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(165) };
    return null;
  } });
  const built = await harness.builder.build("send-token", { owner: ownerKey.publicKey.toBase58(), mint: tokenMint.toBase58(), recipient: recipient.toBase58(), amount: "1000000" });
  const transaction = VersionedTransaction.deserialize(Buffer.from(built.transaction, "base64"));
  const ataInstructions = transaction.message.compiledInstructions.filter((instruction) => transaction.message.staticAccountKeys[instruction.programIdIndex].equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.equal(ataInstructions.length, 2);
  assert.ok(ataInstructions.every(({ data }) => data.length === 1 && data[0] === 1));
  assert.deepEqual(ataInstructions.map((instruction) => transaction.message.staticAccountKeys[instruction.accountKeyIndexes[1]].toBase58()).sort(), [recipientAta.toBase58(), treasuryAta.toBase58()].sort());
  assert.ok(ataInstructions.every((instruction) => transaction.message.staticAccountKeys[instruction.accountKeyIndexes[0]].equals(ownerKey.publicKey)));
  const walletInstruction = transaction.message.compiledInstructions.find((instruction) => transaction.message.staticAccountKeys[instruction.programIdIndex].equals(config.programId));
  const decoded = harness.coder.instruction.decode(Buffer.from(walletInstruction.data));
  assert.equal(decoded.name, "sendToken");
  assert.equal(decoded.data.amount.toString(), "1000000");
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[0]].toBase58(), ownerKey.publicKey.toBase58());
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[3]].toBase58(), tokenMint.toBase58());
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[4]].toBase58(), walletAta.toBase58());
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[5]].toBase58(), recipientAta.toBase58());
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[6]].toBase58(), treasuryAta.toBase58());
  assert.equal(transaction.message.staticAccountKeys[walletInstruction.accountKeyIndexes[7]].toBase58(), TOKEN_2022_PROGRAM_ID.toBase58());
  assert.equal(built.cost.rentLamports, "1781760");

  const extendedHarness = makeBuilderHarness({ ownerKey, accountInfo: (key) => key.equals(tokenMint) ? { owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(83) } : null });
  await assert.rejects(extendedHarness.builder.build("send-token", { owner: ownerKey.publicKey.toBase58(), mint: tokenMint.toBase58(), recipient: recipient.toBase58(), amount: "1" }), { code: "unsupported_mint_extension" });
  const pausedHarness = makeBuilderHarness({ ownerKey, configPatch: { paused: true } });
  await assert.rejects(pausedHarness.builder.build("create-wallet", { owner: ownerKey.publicKey.toBase58() }), { code: "program_paused" });
  await assert.rejects(pausedHarness.builder.build("request-verification", { owner: ownerKey.publicKey.toBase58() }), { code: "program_paused" });
  await assert.rejects(pausedHarness.builder.build("send-sol", { owner: ownerKey.publicKey.toBase58(), recipient: recipient.toBase58(), amount: "1" }), { code: "program_paused" });
  await assert.rejects(pausedHarness.builder.build("send-token", { owner: ownerKey.publicKey.toBase58(), mint: tokenMint.toBase58(), recipient: recipient.toBase58(), amount: "1" }), { code: "program_paused" });
  assert.equal(pausedHarness.simulations.length, 0);
});
