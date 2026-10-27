import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  calculateFee,
  createReceiveAtaInstruction,
  getReceiveAddresses,
  getWalletBalances,
} from "../../sdk/dist/index.js";

const programId = Keypair.fromSeed(Buffer.alloc(32, 7)).publicKey;
const owner = Keypair.fromSeed(Buffer.alloc(32, 8)).publicKey;
const mint = Keypair.fromSeed(Buffer.alloc(32, 9)).publicKey;

test("derives deterministic wallet and SOL receive PDAs", () => {
  const first = getReceiveAddresses(programId, owner);
  const second = getReceiveAddresses(programId, owner);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.wallet,
    PublicKey.findProgramAddressSync(
      [Buffer.from("wallet"), owner.toBuffer()],
      programId,
    )[0],
  );
  assert.deepEqual(
    first.sol,
    PublicKey.findProgramAddressSync(
      [Buffer.from("sol"), owner.toBuffer()],
      programId,
    )[0],
  );
  assert.notDeepEqual(first.wallet, first.sol);
});

test("rejects number amounts in the fee helper", () => {
  assert.throws(() => calculateFee(1, 25), { message: "InvalidAmount" });
});

test("creates ATAs for supported token programs and rejects other programs", () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 10)).publicKey;
  const wallet = getReceiveAddresses(programId, owner).wallet;

  for (const tokenProgramId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const instruction = createReceiveAtaInstruction(payer, wallet, mint, tokenProgramId);
    assert(instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    assert(instruction.keys[1].pubkey.equals(
      getAssociatedTokenAddressSync(mint, wallet, true, tokenProgramId),
    ));
    assert(instruction.keys[5].pubkey.equals(tokenProgramId));
  }

  assert.throws(
    () => createReceiveAtaInstruction(payer, wallet, mint, Keypair.fromSeed(Buffer.alloc(32, 11)).publicKey),
    { message: "Unsupported token program" },
  );
});

test("reads SOL and legacy plus Token-2022 balances for the wallet PDA", async () => {
  const wallet = getReceiveAddresses(programId, owner).wallet;
  const legacyMint = Keypair.fromSeed(Buffer.alloc(32, 12)).publicKey;
  const token2022Mint = Keypair.fromSeed(Buffer.alloc(32, 13)).publicKey;
  const calls = [];
  const connection = {
    getBalance: async (address) => {
      calls.push(["sol", address]);
      return 42;
    },
    getParsedTokenAccountsByOwner: async (authority, filter) => {
      calls.push(["token", authority, filter.programId]);
      const tokenMint = filter.programId.equals(TOKEN_PROGRAM_ID) ? legacyMint : token2022Mint;
      return {
        value: [{
          pubkey: Keypair.fromSeed(Buffer.alloc(32, filter.programId.equals(TOKEN_PROGRAM_ID) ? 24 : 25)).publicKey,
          account: {
            owner: filter.programId,
            data: {
              parsed: {
                info: {
                  mint: tokenMint.toBase58(),
                  tokenAmount: { amount: "1234567", decimals: 6, uiAmount: 1.234567 },
                },
              },
            },
          },
        }],
      };
    },
  };

  const result = await getWalletBalances(connection, programId, owner, wallet);
  assert.equal(result.solLamports, "42");
  assert.deepEqual(result.tokenAccounts.map(({ mint: key, rawAmount, decimals, uiAmountString }) => [
    key.toBase58(), rawAmount, decimals, uiAmountString,
  ]), [
    [legacyMint.toBase58(), "1234567", 6, "1.234567"],
    [token2022Mint.toBase58(), "1234567", 6, "1.234567"],
  ]);
  assert.equal(calls.length, 3);
  await assert.rejects(
    getWalletBalances(connection, programId, owner, Keypair.fromSeed(Buffer.alloc(32, 14)).publicKey),
    { message: "Wallet PDA does not match owner" },
  );
});
