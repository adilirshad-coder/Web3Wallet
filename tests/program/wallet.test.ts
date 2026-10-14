import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { createHash } from "crypto";
import { Wallet } from "../../target/types/wallet";

import { expect } from "chai";
import {
  createMint,
  mintTo,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTS                                 */
/* -------------------------------------------------------------------------- */

// Must match programs/wallet/src/constants.rs
const SEEDS = {
  WALLET: "wallet",
  SOL: "sol",
  CONFIG: "config",
} as const;

const DEFAULT_FEE_BPS = 25;
const DEFAULT_MAX_FEE_BPS = 100;
const DEFAULT_MAX_SLIPPAGE_BPS = 500;

const JUPITER_PROGRAM_ID = new anchor.web3.PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
);
const BPF_LOADER_UPGRADEABLE = new anchor.web3.PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const U64_MAX = new anchor.BN("18446744073709551615");
const ZERO_HASH = Array(32).fill(0);

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

const findpda = (
  programId: anchor.web3.PublicKey,
  seeds: (Buffer | Uint8Array)[],
): anchor.web3.PublicKey => {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(seeds, programId);
  return pda;
};

const findpdaBump = (
  programId: anchor.web3.PublicKey,
  seeds: (Buffer | Uint8Array)[],
): [anchor.web3.PublicKey, number] =>
  anchor.web3.PublicKey.findProgramAddressSync(seeds, programId);

const airdrop = async (
  connection: anchor.web3.Connection,
  publicKey: anchor.web3.PublicKey,
  lamports: number,
) => {
  const signature = await connection.requestAirdrop(publicKey, lamports);
  await connection.confirmTransaction(signature, "confirmed");
};

const getBlockTime = async (
  connection: anchor.web3.Connection,
): Promise<number> => {
  const slot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(slot);
  if (blockTime === null) {
    throw new Error("Failed to fetch the block time");
  }
  return blockTime;
};

/**
 * Asserts that a promise rejects with one of the expected Anchor error codes.
 * Unlike a bare try/catch, this FAILS the test if the transaction succeeds.
 */
const expectFailure = async (
  promise: Promise<unknown>,
  expectedCode: string | string[],
) => {
  const expected = Array.isArray(expectedCode) ? expectedCode : [expectedCode];
  try {
    await promise;
  } catch (err: unknown) {
    const anyErr = err as any;
    const actualCode =
      anyErr?.error?.errorCode?.code ??
      anyErr?.errorCode?.code ??
      anyErr?.code;
    const runtimeLogs = anyErr?.logs ? JSON.stringify(anyErr.logs) : anyErr?.message;
    expect(expected, `unexpected runtime error: ${runtimeLogs}`).to.include(
      actualCode,
    );
    return;
  }
  expect.fail(`Expected failure with ${expected.join(" | ")} but tx succeeded`);
};

/** For failures that are runtime errors rather than Anchor errors. */
const expectAnyFailure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch {
    return;
  }
  expect.fail("Expected the transaction to fail but it succeeded");
};

/** Mirrors utils::calculate_fee (ceiling division). */
const feeOf = (amount: number, bps: number): number =>
  bps === 0 ? 0 : Math.ceil((amount * bps) / 10_000);

/** Anchor decodes Rust enums as { variantName: {} } */
const statusKey = (status: object): string => Object.keys(status)[0];

const testKeypair = (label: string): anchor.web3.Keypair =>
  anchor.web3.Keypair.fromSeed(
    createHash("sha256").update(`wallet-runtime-test:${label}`).digest(),
  );

const VERIFICATION = {
  none: { none: {} },
  pending: { pending: {} },
  verified: { verified: {} },
  rejected: { rejected: {} },
  revoked: { revoked: {} },
} as const;

/* -------------------------------------------------------------------------- */
/*                                    TESTS                                   */
/* -------------------------------------------------------------------------- */

describe("Testing the custodial wallet program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const transactionSignatures: string[] = [];
  const providerWithHook = provider as any;
  const sendAndConfirm = providerWithHook.sendAndConfirm.bind(providerWithHook);
  providerWithHook.sendAndConfirm = async (...args: any[]) => {
    const signature = await sendAndConfirm(...args);
    if (typeof signature !== "string" || signature.length === 0) {
      throw new Error("Runtime transaction completed without returning a signature");
    }
    transactionSignatures.push(signature);
    return signature;
  };
  const program = anchor.workspace.wallet as Program<Wallet>;
  const connection = provider.connection;

  // The provider wallet is the program deployer == upgrade authority.
  const adminWallet = (provider.wallet as anchor.Wallet).payer;
  const verifierWallet = testKeypair("verifier");
  const treasuryWallet = testKeypair("treasury");
  const newAdminWallet = testKeypair("new-admin");
  const userA = testKeypair("user-a"); // main happy-path user
  const userB = testKeypair("user-b"); // edge-case user (exact balances)
  const userC = testKeypair("user-c"); // never creates a wallet before pause test
  const attacker = testKeypair("attacker");

  let rentExempt: number; // minimum balance for a 0-data account

  let configPda: anchor.web3.PublicKey;
  let programDataPda: anchor.web3.PublicKey;
  let walletPdaA: anchor.web3.PublicKey;
  let solVaultPdaA: anchor.web3.PublicKey;
  let walletPdaB: anchor.web3.PublicKey;
  let solVaultPdaB: anchor.web3.PublicKey;
  let walletPdaC: anchor.web3.PublicKey;

  // token fixtures
  let mint: anchor.web3.PublicKey;
  let otherMint: anchor.web3.PublicKey;
  let mint2022: anchor.web3.PublicKey;
  let walletAAta: anchor.web3.PublicKey;
  let treasuryAta: anchor.web3.PublicKey;
  let recipientWallet: anchor.web3.Keypair;
  let recipientAta: anchor.web3.PublicKey;
  let recipientOtherMintAta: anchor.web3.PublicKey;

  after(() => {
    console.log(`Committed runtime transactions: ${transactionSignatures.length}`);
    console.log(`Runtime transaction signature samples: ${JSON.stringify(transactionSignatures.slice(0, 3))}`);
  });

  /* ------------------------------ shared helpers ----------------------------- */

  const fundVault = async (vault: anchor.web3.PublicKey, lamports: number) => {
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: adminWallet.publicKey,
        toPubkey: vault,
        lamports,
      }),
    );
    await provider.sendAndConfirm(tx, [adminWallet]);
  };

  const createWallet = (owner: anchor.web3.Keypair) =>
    program.methods
      .createWallet()
      .accountsPartial({ owner: owner.publicKey })
      .signers([owner])
      .rpc();

  const sendSol = (
    owner: anchor.web3.Keypair,
    amount: anchor.BN,
    recipient: anchor.web3.PublicKey,
    overrides: {
      treasury?: anchor.web3.PublicKey;
      wallet?: anchor.web3.PublicKey;
    } = {},
  ) =>
    program.methods
      .sendSol(amount)
      .accountsPartial({
        owner: owner.publicKey,
        recipient,
        treasury: overrides.treasury ?? treasuryWallet.publicKey,
        ...(overrides.wallet ? { wallet: overrides.wallet } : {}),
      })
      .signers([owner])
      .rpc();

  const sendToken = (
    owner: anchor.web3.Keypair,
    amount: anchor.BN,
    accounts: {
      mint: anchor.web3.PublicKey;
      walletTokenAccount: anchor.web3.PublicKey;
      recipientTokenAccount: anchor.web3.PublicKey;
      treasuryTokenAccount: anchor.web3.PublicKey;
      tokenProgram?: anchor.web3.PublicKey;
      wallet?: anchor.web3.PublicKey;
    },
  ) =>
    program.methods
      .sendToken(amount)
      .accountsPartial({
        owner: owner.publicKey,
        tokenProgram: accounts.tokenProgram ?? TOKEN_PROGRAM_ID,
        ...accounts,
      })
      .signers([owner])
      .rpc();

  const getFeeEvents = async (signature: string) => {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const parser = new anchor.EventParser(program.programId, program.coder);
    return [...parser.parseLogs(tx?.meta?.logMessages ?? [])];
  };

  const adminSetFee = (feeBps: number) =>
    program.methods
      .updateFeeBps(feeBps)
      .accountsPartial({ admin: adminWallet.publicKey })
      .signers([adminWallet])
      .rpc();

  const adminSetTreasury = (treasury: anchor.web3.PublicKey) =>
    program.methods
      .setTreasury(treasury)
      .accountsPartial({ admin: adminWallet.publicKey })
      .signers([adminWallet])
      .rpc();

  const adminSetPaused = (paused: boolean) =>
    program.methods
      .setPaused(paused)
      .accountsPartial({ admin: adminWallet.publicKey })
      .signers([adminWallet])
      .rpc();

  /* ---------------------------------- setup --------------------------------- */

  before(async () => {
    configPda = findpda(program.programId, [
      anchor.utils.bytes.utf8.encode(SEEDS.CONFIG),
    ]);
    programDataPda = findpda(BPF_LOADER_UPGRADEABLE, [
      program.programId.toBuffer(),
    ]);

    walletPdaA = findpda(program.programId, [
      anchor.utils.bytes.utf8.encode(SEEDS.WALLET),
      userA.publicKey.toBuffer(),
    ]);
    solVaultPdaA = findpda(program.programId, [
      anchor.utils.bytes.utf8.encode(SEEDS.SOL),
      userA.publicKey.toBuffer(),
    ]);
    walletPdaB = findpda(program.programId, [
      anchor.utils.bytes.utf8.encode(SEEDS.WALLET),
      userB.publicKey.toBuffer(),
    ]);
    solVaultPdaB = findpda(program.programId, [
      anchor.utils.bytes.utf8.encode(SEEDS.SOL),
      userB.publicKey.toBuffer(),
    ]);
    walletPdaC = findpda(program.programId, [
      anchor.utils.bytes.utf8.encode(SEEDS.WALLET),
      userC.publicKey.toBuffer(),
    ]);

    rentExempt = await connection.getMinimumBalanceForRentExemption(0);

    console.log("Transferring SOL to test accounts...");
    await Promise.all([
      airdrop(connection, adminWallet.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      airdrop(connection, verifierWallet.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      // the treasury must be pre-funded (see TreasuryBelowRentExempt)
      airdrop(connection, treasuryWallet.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      airdrop(connection, newAdminWallet.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      airdrop(connection, userA.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      airdrop(connection, userB.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      airdrop(connection, userC.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
      airdrop(connection, attacker.publicKey, 10 * anchor.web3.LAMPORTS_PER_SOL),
    ]);
    console.log("Transfer of SOL success");
  });

  /* -------------------------------------------------------------------------- */
  describe("1. Config Initialization", () => {
    const initialize = (
      signer: anchor.web3.Keypair,
      treasury: anchor.web3.PublicKey,
      verifier: anchor.web3.PublicKey,
      jupiter: anchor.web3.PublicKey,
    ) =>
      program.methods
        .initializeConfig(verifier, jupiter)
        .accountsPartial({
          admin: signer.publicKey,
          programData: programDataPda,
          treasury,
        })
        .signers([signer])
        .rpc();

    it("1.1 Should fail if signer is not the upgrade authority!", async () => {
      await expectFailure(
        initialize(
          attacker,
          treasuryWallet.publicKey,
          verifierWallet.publicKey,
          JUPITER_PROGRAM_ID,
        ),
        "UnauthorizedInitializer",
      );
    });

    it("1.2 Should fail with a zero treasury address!", async () => {
      await expectFailure(
        initialize(
          adminWallet,
          anchor.web3.PublicKey.default,
          verifierWallet.publicKey,
          JUPITER_PROGRAM_ID,
        ),
        "InvalidTreasury",
      );
    });

    it("1.3 Should fail with a zero verifier address!", async () => {
      await expectFailure(
        initialize(
          adminWallet,
          treasuryWallet.publicKey,
          anchor.web3.PublicKey.default,
          JUPITER_PROGRAM_ID,
        ),
        "InvalidVerifier",
      );
    });

    it("1.4 Should fail with a zero Jupiter program id!", async () => {
      await expectFailure(
        initialize(
          adminWallet,
          treasuryWallet.publicKey,
          verifierWallet.publicKey,
          anchor.web3.PublicKey.default,
        ),
        "InvalidJupiterProgram",
      );
    });

    it("1.5 Initializes config with default values!", async () => {
      await initialize(
        adminWallet,
        treasuryWallet.publicKey,
        verifierWallet.publicKey,
        JUPITER_PROGRAM_ID,
      );

      const config = await program.account.config.fetch(configPda);
      expect(config.admin.toBase58()).to.equal(adminWallet.publicKey.toBase58());
      expect(config.pendingAdmin.toBase58()).to.equal(
        anchor.web3.PublicKey.default.toBase58(),
      );
      expect(config.treasury.toBase58()).to.equal(
        treasuryWallet.publicKey.toBase58(),
      );
      expect(config.verifier.toBase58()).to.equal(
        verifierWallet.publicKey.toBase58(),
      );
      expect(config.jupiterProgramId.toBase58()).to.equal(
        JUPITER_PROGRAM_ID.toBase58(),
      );
      expect(config.feeBps).to.equal(DEFAULT_FEE_BPS);
      expect(config.maxFeeBps).to.equal(DEFAULT_MAX_FEE_BPS);
      expect(config.maxSlippageBps).to.equal(DEFAULT_MAX_SLIPPAGE_BPS);
      expect(config.paused).to.equal(false);
    });

    it("1.6 Should fail to initialize config twice!", async () => {
      await expectAnyFailure(
        initialize(
          adminWallet,
          treasuryWallet.publicKey,
          verifierWallet.publicKey,
          JUPITER_PROGRAM_ID,
        ),
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  describe("2. Admin Configuration", () => {
    it("2.1 Admin updates the fee!", async () => {
      await adminSetFee(50);
      expect((await program.account.config.fetch(configPda)).feeBps).to.equal(50);
      await adminSetFee(DEFAULT_FEE_BPS); // restore
    });

    it("2.2 Should fail if fee exceeds max_fee_bps!", async () => {
      await expectFailure(adminSetFee(DEFAULT_MAX_FEE_BPS + 1), "FeeTooHigh");
    });

    it("2.3 Should fail if a non-admin updates the fee!", async () => {
      await expectFailure(
        program.methods
          .updateFeeBps(10)
          .accountsPartial({ admin: attacker.publicKey })
          .signers([attacker])
          .rpc(),
        "ConstraintHasOne",
      );
    });

    it("2.4 Admin updates the limits!", async () => {
      await program.methods
        .setLimits(200, 300)
        .accountsPartial({ admin: adminWallet.publicKey })
        .signers([adminWallet])
        .rpc();
      const config = await program.account.config.fetch(configPda);
      expect(config.maxFeeBps).to.equal(200);
      expect(config.maxSlippageBps).to.equal(300);

      // restore defaults
      await program.methods
        .setLimits(DEFAULT_MAX_FEE_BPS, DEFAULT_MAX_SLIPPAGE_BPS)
        .accountsPartial({ admin: adminWallet.publicKey })
        .signers([adminWallet])
        .rpc();
    });

    it("2.5 Should fail if limits exceed 10000 bps!", async () => {
      await expectFailure(
        program.methods
          .setLimits(10_001, 100)
          .accountsPartial({ admin: adminWallet.publicKey })
          .signers([adminWallet])
          .rpc(),
        "InvalidLimits",
      );
      await expectFailure(
        program.methods
          .setLimits(100, 10_001)
          .accountsPartial({ admin: adminWallet.publicKey })
          .signers([adminWallet])
          .rpc(),
        "InvalidLimits",
      );
    });

    it("2.6 Should fail if new max_fee_bps is below the current fee!", async () => {
      await expectFailure(
        program.methods
          .setLimits(DEFAULT_FEE_BPS - 1, DEFAULT_MAX_SLIPPAGE_BPS)
          .accountsPartial({ admin: adminWallet.publicKey })
          .signers([adminWallet])
          .rpc(),
        "FeeTooHigh",
      );
    });

    it("2.7 Admin changes the verifier and restores it!", async () => {
      const newVerifier = testKeypair("new-verifier").publicKey;
      await program.methods
        .setVerifier(newVerifier)
        .accountsPartial({ admin: adminWallet.publicKey })
        .signers([adminWallet])
        .rpc();
      expect(
        (await program.account.config.fetch(configPda)).verifier.toBase58(),
      ).to.equal(newVerifier.toBase58());

      await program.methods
        .setVerifier(verifierWallet.publicKey)
        .accountsPartial({ admin: adminWallet.publicKey })
        .signers([adminWallet])
        .rpc();
    });

    it("2.8 Should fail to set a zero verifier or zero treasury!", async () => {
      await expectFailure(
        program.methods
          .setVerifier(anchor.web3.PublicKey.default)
          .accountsPartial({ admin: adminWallet.publicKey })
          .signers([adminWallet])
          .rpc(),
        "InvalidVerifier",
      );
      await expectFailure(
        adminSetTreasury(anchor.web3.PublicKey.default),
        "InvalidTreasury",
      );
    });

    it("2.9 Should fail if a non-admin changes the treasury!", async () => {
      await expectFailure(
        program.methods
          .setTreasury(attacker.publicKey)
          .accountsPartial({ admin: attacker.publicKey })
          .signers([attacker])
          .rpc(),
        "ConstraintHasOne",
      );
    });

    it("2.10 Two-step admin transfer works end to end!", async () => {
      // proposing a zero admin is rejected
      await expectFailure(
        program.methods
          .proposeAdmin(anchor.web3.PublicKey.default)
          .accountsPartial({ admin: adminWallet.publicKey })
          .signers([adminWallet])
          .rpc(),
        "InvalidAdmin",
      );

      // propose newAdmin
      await program.methods
        .proposeAdmin(newAdminWallet.publicKey)
        .accountsPartial({ admin: adminWallet.publicKey })
        .signers([adminWallet])
        .rpc();
      expect(
        (await program.account.config.fetch(configPda)).pendingAdmin.toBase58(),
      ).to.equal(newAdminWallet.publicKey.toBase58());

      // someone else cannot accept
      await expectFailure(
        program.methods
          .acceptAdmin()
          .accountsPartial({ pendingAdmin: attacker.publicKey })
          .signers([attacker])
          .rpc(),
        "InvalidAdmin",
      );

      // newAdmin accepts
      await program.methods
        .acceptAdmin()
        .accountsPartial({ pendingAdmin: newAdminWallet.publicKey })
        .signers([newAdminWallet])
        .rpc();
      let config = await program.account.config.fetch(configPda);
      expect(config.admin.toBase58()).to.equal(newAdminWallet.publicKey.toBase58());
      expect(config.pendingAdmin.toBase58()).to.equal(
        anchor.web3.PublicKey.default.toBase58(),
      );

      // old admin is locked out
      await expectFailure(adminSetFee(30), "ConstraintHasOne");

      // hand control back so the remaining suites run as adminWallet
      await program.methods
        .proposeAdmin(adminWallet.publicKey)
        .accountsPartial({ admin: newAdminWallet.publicKey })
        .signers([newAdminWallet])
        .rpc();
      await program.methods
        .acceptAdmin()
        .accountsPartial({ pendingAdmin: adminWallet.publicKey })
        .signers([adminWallet])
        .rpc();
      config = await program.account.config.fetch(configPda);
      expect(config.admin.toBase58()).to.equal(adminWallet.publicKey.toBase58());
    });
  });

  /* -------------------------------------------------------------------------- */
  describe("3. Create Wallet", () => {
    it("3.1 Creates a wallet for user A!", async () => {
      await createWallet(userA);

      const [, walletBump] = findpdaBump(program.programId, [
        anchor.utils.bytes.utf8.encode(SEEDS.WALLET),
        userA.publicKey.toBuffer(),
      ]);
      const [, vaultBump] = findpdaBump(program.programId, [
        anchor.utils.bytes.utf8.encode(SEEDS.SOL),
        userA.publicKey.toBuffer(),
      ]);

      const wallet = await program.account.userWallet.fetch(walletPdaA);
      expect(wallet.owner.toBase58()).to.equal(userA.publicKey.toBase58());
      expect(wallet.bump).to.equal(walletBump);
      expect(wallet.solVaultBump).to.equal(vaultBump);
      expect(wallet.version).to.equal(1);
      expect(wallet.createdAt.toNumber()).to.be.greaterThan(0);
      expect(statusKey(wallet.verification.status)).to.equal("none");
      expect(wallet.verification.level).to.equal(0);
      expect(wallet.verification.expiresAt.toNumber()).to.equal(0);
      expect(wallet.verification.attestationHash).to.deep.equal(ZERO_HASH);
    });

    it("3.2 Should fail to create the same wallet twice!", async () => {
      await expectAnyFailure(createWallet(userA));
    });

    it("3.3 Creates a wallet for user B!", async () => {
      await createWallet(userB);
      const wallet = await program.account.userWallet.fetch(walletPdaB);
      expect(wallet.owner.toBase58()).to.equal(userB.publicKey.toBase58());
    });
  });

  /* -------------------------------------------------------------------------- */
  describe("4. Send SOL", () => {
    const sendAmount = 1 * anchor.web3.LAMPORTS_PER_SOL;

    it("4.1 Funds user A's SOL vault!", async () => {
      await fundVault(solVaultPdaA, 5 * anchor.web3.LAMPORTS_PER_SOL);
      expect(await connection.getBalance(solVaultPdaA)).to.equal(
        5 * anchor.web3.LAMPORTS_PER_SOL,
      );
    });

    it("4.2 Sends SOL, deducts fee and pays the treasury!", async () => {
      const recipient = testKeypair("sol-success-recipient");
      const fee = feeOf(sendAmount, DEFAULT_FEE_BPS);

      const vaultBefore = await connection.getBalance(solVaultPdaA);
      const treasuryBefore = await connection.getBalance(treasuryWallet.publicKey);

      const sig = await sendSol(
        userA,
        new anchor.BN(sendAmount),
        recipient.publicKey,
      );

      expect(await connection.getBalance(recipient.publicKey)).to.equal(sendAmount);
      expect(await connection.getBalance(treasuryWallet.publicKey)).to.equal(
        treasuryBefore + fee,
      );
      expect(await connection.getBalance(solVaultPdaA)).to.equal(
        vaultBefore - sendAmount - fee,
      );

      // FeeCollected event
      const events = await getFeeEvents(sig);
      const feeEvent = events.find((e) => e.name.toLowerCase() === "feecollected");
      expect(feeEvent, "FeeCollected event missing").to.not.be.undefined;
      expect((feeEvent!.data as any).amount.toString()).to.equal(fee.toString());
      expect((feeEvent!.data as any).mint.toBase58()).to.equal(
        anchor.web3.PublicKey.default.toBase58(),
      );
      expect((feeEvent!.data as any).wallet.toBase58()).to.equal(
        walletPdaA.toBase58(),
      );
    });

    it("4.3 Should fail with a zero amount!", async () => {
      await expectFailure(
        sendSol(userA, new anchor.BN(0), testKeypair("sol-zero-recipient").publicKey),
        "ZeroAmount",
      );
    });

    it("4.4 Should fail if the recipient is the vault itself!", async () => {
      await expectFailure(
        sendSol(userA, new anchor.BN(sendAmount), solVaultPdaA),
        "InvalidRecipient",
      );
    });

    it("4.5 Should fail with insufficient balance!", async () => {
      const vaultBefore = await connection.getBalance(solVaultPdaA);
      const treasuryBefore = await connection.getBalance(treasuryWallet.publicKey);
      const recipient = testKeypair("sol-insufficient-recipient").publicKey;
      await expectFailure(
        sendSol(
          userA,
          new anchor.BN(100 * anchor.web3.LAMPORTS_PER_SOL),
          recipient,
        ),
        "InsufficientBalance",
      );
      expect(await connection.getBalance(solVaultPdaA)).to.equal(vaultBefore);
      expect(await connection.getBalance(treasuryWallet.publicKey)).to.equal(treasuryBefore);
      expect(await connection.getBalance(recipient)).to.equal(0);
    });

    it("4.6 Should fail with MathOverflow when amount + fee overflows u64!", async () => {
      await expectFailure(
        sendSol(userA, U64_MAX, testKeypair("sol-overflow-recipient").publicKey),
        "MathOverflow",
      );
    });

    it("4.7 Should fail if a new recipient would be below rent-exempt!", async () => {
      await expectFailure(
        sendSol(userA, new anchor.BN(1_000), testKeypair("sol-rent-recipient").publicKey),
        "RecipientBelowRentExempt",
      );
    });

    it("4.8 Should fail if the vault would drop below rent-exempt!", async () => {
      await fundVault(solVaultPdaB, 2_000_000);
      // leaves ~496k lamports (< rent-exempt minimum of ~890k) in the vault
      await expectFailure(
        sendSol(
          userB,
          new anchor.BN(1_500_000),
          testKeypair("sol-rent-vault-recipient").publicKey,
        ),
        "VaultNotRentExempt",
      );
    });

    it("4.9 Allows draining the vault to exactly zero!", async () => {
      const vaultBalance = await connection.getBalance(solVaultPdaB);
      // largest amount such that amount + fee == vault balance
      const amount = Math.floor((vaultBalance * 10_000) / (10_000 + DEFAULT_FEE_BPS));
      expect(amount + feeOf(amount, DEFAULT_FEE_BPS)).to.equal(vaultBalance);

      const recipient = testKeypair("sol-drain-recipient");
      await sendSol(userB, new anchor.BN(amount), recipient.publicKey);

      expect(await connection.getBalance(solVaultPdaB)).to.equal(0);
      expect(await connection.getBalance(recipient.publicKey)).to.equal(amount);
    });

    it("4.10 Should fail if the first fee to the treasury is below rent-exempt!", async () => {
      const unfundedTreasury = testKeypair("unfunded-treasury");
      await adminSetTreasury(unfundedTreasury.publicKey);
      try {
        await expectFailure(
          sendSol(
            userA,
            new anchor.BN(1_000_000), // fee = 2,500 lamports < rent
            testKeypair("sol-unfunded-treasury-recipient").publicKey,
            { treasury: unfundedTreasury.publicKey },
          ),
          "TreasuryBelowRentExempt",
        );
      } finally {
        await adminSetTreasury(treasuryWallet.publicKey); // restore
      }
    });

    it("4.11 Charges no fee when fee_bps is zero!", async () => {
      await adminSetFee(0);
      try {
        const recipient = testKeypair("sol-zero-fee-recipient");
        const treasuryBefore = await connection.getBalance(treasuryWallet.publicKey);
        const vaultBefore = await connection.getBalance(solVaultPdaA);

        await sendSol(userA, new anchor.BN(1_000_000), recipient.publicKey);

        expect(await connection.getBalance(treasuryWallet.publicKey)).to.equal(
          treasuryBefore,
        );
        expect(await connection.getBalance(solVaultPdaA)).to.equal(
          vaultBefore - 1_000_000,
        );
      } finally {
        await adminSetFee(DEFAULT_FEE_BPS); // restore
      }
    });

    it("4.12 Should fail if the treasury account is not the configured one!", async () => {
      await expectFailure(
        sendSol(
          userA,
          new anchor.BN(sendAmount),
          testKeypair("sol-wrong-treasury-recipient").publicKey,
          { treasury: attacker.publicKey },
        ),
        "ConstraintAddress",
      );
    });

    it("4.13 Should fail if someone tries to spend another user's wallet!", async () => {
      await expectFailure(
        sendSol(
          attacker,
          new anchor.BN(sendAmount),
          attacker.publicKey,
          { wallet: walletPdaA },
        ),
        "ConstraintSeeds",
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  describe("5. Send Token", () => {
    const DECIMALS = 6;
    const ONE_TOKEN = 10 ** DECIMALS;

    before(async () => {
      recipientWallet = testKeypair("token-recipient");

      mint = await createMint(connection, adminWallet, adminWallet.publicKey, null, DECIMALS);
      otherMint = await createMint(connection, adminWallet, adminWallet.publicKey, null, DECIMALS);

      // the wallet PDA is off-curve => allowOwnerOffCurve = true
      walletAAta = (
        await getOrCreateAssociatedTokenAccount(
          connection, adminWallet, mint, walletPdaA, true,
        )
      ).address;
      treasuryAta = (
        await getOrCreateAssociatedTokenAccount(
          connection, adminWallet, mint, treasuryWallet.publicKey,
        )
      ).address;
      recipientAta = (
        await getOrCreateAssociatedTokenAccount(
          connection, adminWallet, mint, recipientWallet.publicKey,
        )
      ).address;
      recipientOtherMintAta = (
        await getOrCreateAssociatedTokenAccount(
          connection, adminWallet, otherMint, recipientWallet.publicKey,
        )
      ).address;

      await mintTo(connection, adminWallet, mint, walletAAta, adminWallet, 1_000 * ONE_TOKEN);
    });

    const baseAccounts = () => ({
      mint,
      walletTokenAccount: walletAAta,
      recipientTokenAccount: recipientAta,
      treasuryTokenAccount: treasuryAta,
    });

    it("5.1 Sends tokens, deducts fee and pays the treasury!", async () => {
      const amount = 100 * ONE_TOKEN;
      const fee = feeOf(amount, DEFAULT_FEE_BPS);

      const walletBefore = (await getAccount(connection, walletAAta)).amount;
      const treasuryBefore = (await getAccount(connection, treasuryAta)).amount;
      const recipientBefore = (await getAccount(connection, recipientAta)).amount;

      const sig = await sendToken(userA, new anchor.BN(amount), baseAccounts());

      expect((await getAccount(connection, recipientAta)).amount - recipientBefore).to.equal(BigInt(amount));
      expect((await getAccount(connection, treasuryAta)).amount - treasuryBefore).to.equal(BigInt(fee));
      expect(walletBefore - (await getAccount(connection, walletAAta)).amount).to.equal(BigInt(amount + fee));

      const events = await getFeeEvents(sig);
      const feeEvent = events.find((e) => e.name.toLowerCase() === "feecollected");
      expect(feeEvent, "FeeCollected event missing").to.not.be.undefined;
      expect((feeEvent!.data as any).amount.toString()).to.equal(fee.toString());
      expect((feeEvent!.data as any).mint.toBase58()).to.equal(mint.toBase58());
    });

    it("5.2 Should fail with a zero amount!", async () => {
      await expectFailure(sendToken(userA, new anchor.BN(0), baseAccounts()), "ZeroAmount");
    });

    it("5.3 Should fail with insufficient balance (amount + fee > balance)!", async () => {
      const balance = (await getAccount(connection, walletAAta)).amount;
      const treasuryBefore = (await getAccount(connection, treasuryAta)).amount;
      const recipientBefore = (await getAccount(connection, recipientAta)).amount;
      await expectFailure(
        sendToken(userA, new anchor.BN(balance.toString()), baseAccounts()),
        "InsufficientBalance",
      );
      expect((await getAccount(connection, walletAAta)).amount).to.equal(balance);
      expect((await getAccount(connection, treasuryAta)).amount).to.equal(treasuryBefore);
      expect((await getAccount(connection, recipientAta)).amount).to.equal(recipientBefore);
    });

    it("5.4 Should fail with MathOverflow when amount + fee overflows u64!", async () => {
      await expectFailure(sendToken(userA, U64_MAX, baseAccounts()), "MathOverflow");
    });

    it("5.5 Should fail if the recipient token account has a different mint!", async () => {
      await expectFailure(
        sendToken(userA, new anchor.BN(ONE_TOKEN), {
          ...baseAccounts(),
          recipientTokenAccount: recipientOtherMintAta,
        }),
        "InvalidMint",
      );
    });

    it("5.6 Should fail if the treasury token account is not the treasury's ATA!", async () => {
      await expectFailure(
        sendToken(userA, new anchor.BN(ONE_TOKEN), {
          ...baseAccounts(),
          treasuryTokenAccount: recipientAta,
        }),
        ["ConstraintAssociated", "ConstraintTokenOwner"],
      );
    });

    it("5.7 Should fail if someone tries to spend another user's token account!", async () => {
      await expectFailure(
        sendToken(attacker, new anchor.BN(ONE_TOKEN), {
          ...baseAccounts(),
          wallet: walletPdaA,
        }),
        "ConstraintSeeds",
      );
    });

    it("5.8 Sends a base (no-extension) Token-2022 mint!", async () => {
      mint2022 = await createMint(
        connection, adminWallet, adminWallet.publicKey, null, DECIMALS,
        undefined, undefined, TOKEN_2022_PROGRAM_ID,
      );
      const ata = (owner: anchor.web3.PublicKey, offCurve = false) =>
        getOrCreateAssociatedTokenAccount(
          connection, adminWallet, mint2022, owner, offCurve,
          undefined, undefined, TOKEN_2022_PROGRAM_ID,
        ).then((a) => a.address);

      const wallet22 = await ata(walletPdaA, true);
      const treasury22 = await ata(treasuryWallet.publicKey);
      const recipient22 = await ata(recipientWallet.publicKey);
      await mintTo(
        connection, adminWallet, mint2022, wallet22, adminWallet, 500 * ONE_TOKEN,
        [], undefined, TOKEN_2022_PROGRAM_ID,
      );

      const amount = 10 * ONE_TOKEN;
      const fee = feeOf(amount, DEFAULT_FEE_BPS);

      await sendToken(userA, new anchor.BN(amount), {
        mint: mint2022,
        walletTokenAccount: wallet22,
        recipientTokenAccount: recipient22,
        treasuryTokenAccount: treasury22,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      });

      const acct = (a: anchor.web3.PublicKey) =>
        getAccount(connection, a, undefined, TOKEN_2022_PROGRAM_ID);
      expect((await acct(recipient22)).amount).to.equal(BigInt(amount));
      expect((await acct(treasury22)).amount).to.equal(BigInt(fee));
      expect((await acct(wallet22)).amount).to.equal(BigInt(500 * ONE_TOKEN - amount - fee));
    });
  });

  /* -------------------------------------------------------------------------- */
  describe("6. Verification", () => {
    const requestVerification = (owner: anchor.web3.Keypair, wallet?: anchor.web3.PublicKey) =>
      program.methods
        .requestVerification()
        .accountsPartial({
          owner: owner.publicKey,
          ...(wallet ? { wallet } : {}),
        })
        .signers([owner])
        .rpc();

    const setVerification = (
      signer: anchor.web3.Keypair,
      status: object,
      level: number,
      expiresAt: anchor.BN,
      hash: number[] = ZERO_HASH,
      wallet: anchor.web3.PublicKey = walletPdaA,
    ) =>
      program.methods
        .setVerification(status as any, level, expiresAt, hash)
        .accountsPartial({ verifier: signer.publicKey, wallet })
        .signers([signer])
        .rpc();

    const fetchStatus = async () =>
      statusKey((await program.account.userWallet.fetch(walletPdaA)).verification.status);

    it("6.1 Owner requests verification => Pending!", async () => {
      await requestVerification(userA);
      expect(await fetchStatus()).to.equal("pending");
    });

    it("6.2 Should fail to request again while Pending!", async () => {
      await expectFailure(requestVerification(userA), "InvalidVerificationStatus");
    });

    it("6.3 Should fail if someone else requests verification for the wallet!", async () => {
      await expectFailure(requestVerification(attacker, walletPdaA), "ConstraintSeeds");
    });

    it("6.4 Should fail if a non-verifier sets verification!", async () => {
      const future = new anchor.BN((await getBlockTime(connection)) + 3600);
      await expectFailure(
        setVerification(attacker, VERIFICATION.verified, 1, future),
        "ConstraintHasOne",
      );
    });

    it("6.5 Should fail to set status None or Pending!", async () => {
      const future = new anchor.BN((await getBlockTime(connection)) + 3600);
      await expectFailure(
        setVerification(verifierWallet, VERIFICATION.none, 0, future),
        "InvalidVerificationStatus",
      );
      await expectFailure(
        setVerification(verifierWallet, VERIFICATION.pending, 0, future),
        "InvalidVerificationStatus",
      );
    });

    it("6.6 Should fail to set Verified with a past expiry!", async () => {
      const past = new anchor.BN((await getBlockTime(connection)) - 10);
      await expectFailure(
        setVerification(verifierWallet, VERIFICATION.verified, 1, past),
        "InvalidVerificationExpiry",
      );
    });

    it("6.7 Verifier sets Verified with attestation data!", async () => {
      const expiresAt = new anchor.BN((await getBlockTime(connection)) + 3600);
      const hash = Array.from({ length: 32 }, (_, i) => i + 1);

      await setVerification(verifierWallet, VERIFICATION.verified, 2, expiresAt, hash);

      const v = (await program.account.userWallet.fetch(walletPdaA)).verification;
      expect(statusKey(v.status)).to.equal("verified");
      expect(v.level).to.equal(2);
      expect(v.expiresAt.toString()).to.equal(expiresAt.toString());
      expect(v.attestationHash).to.deep.equal(hash);
    });

    it("6.8 Should fail to request verification while Verified!", async () => {
      await expectFailure(requestVerification(userA), "InvalidVerificationStatus");
    });

    it("6.9 Verifier rejects, then owner can re-request (Rejected => Pending)!", async () => {
      await setVerification(verifierWallet, VERIFICATION.rejected, 0, new anchor.BN(0));
      expect(await fetchStatus()).to.equal("rejected");

      await requestVerification(userA);
      const v = (await program.account.userWallet.fetch(walletPdaA)).verification;
      expect(statusKey(v.status)).to.equal("pending");
      // request resets previous attestation data
      expect(v.level).to.equal(0);
      expect(v.attestationHash).to.deep.equal(ZERO_HASH);
    });

    it("6.10 Verifier revokes, then owner can re-request (Revoked => Pending)!", async () => {
      await setVerification(verifierWallet, VERIFICATION.revoked, 0, new anchor.BN(0));
      expect(await fetchStatus()).to.equal("revoked");

      await requestVerification(userA);
      expect(await fetchStatus()).to.equal("pending");
    });
  });

  /* -------------------------------------------------------------------------- */
  describe("7. Swap (disabled)", () => {
    it("7.1 Should always fail with SwapUnavailable!", async () => {
      await expectFailure(
        program.methods
          .swap(new anchor.BN(1_000), new anchor.BN(900), 100, new anchor.BN(1_000_000))
          .accountsPartial({ owner: userA.publicKey })
          .signers([userA])
          .rpc(),
        "SwapUnavailable",
      );
    });

    it("7.2 Should still reject non-owners with a constraint error!", async () => {
      await expectFailure(
        program.methods
          .swap(new anchor.BN(1_000), new anchor.BN(900), 100, new anchor.BN(1_000_000))
          .accountsPartial({ owner: attacker.publicKey, wallet: walletPdaA })
          .signers([attacker])
          .rpc(),
        "ConstraintSeeds",
      );
    });
  });

  /* -------------------------------------------------------------------------- */
  describe("8. Pause Switch", () => {
    before(async () => {
      await adminSetPaused(true);
    });

    after(async () => {
      await adminSetPaused(false); // never leave the program paused
    });

    it("8.1 Admin pauses the program!", async () => {
      expect((await program.account.config.fetch(configPda)).paused).to.equal(true);
    });

    it("8.2 Should fail to create a wallet while paused!", async () => {
      await expectFailure(createWallet(userC), "WalletPaused");
    });

    it("8.3 Should fail to request verification while paused!", async () => {
      // userA is Pending from suite 6, so make sure the pause check wins by using a fresh status
      await setVerificationForPauseTest();
      await expectFailure(
        program.methods
          .requestVerification()
          .accountsPartial({ owner: userA.publicKey })
          .signers([userA])
          .rpc(),
        "WalletPaused",
      );
    });

    it("8.4 Should fail to send SOL while paused!", async () => {
      const vaultBefore = await connection.getBalance(solVaultPdaA);
      const treasuryBefore = await connection.getBalance(treasuryWallet.publicKey);
      const recipient = testKeypair("sol-paused-recipient");
      await expectFailure(
        program.methods
          .sendSol(new anchor.BN(1_000_000))
          .accountsPartial({
            owner: userA.publicKey,
            recipient: recipient.publicKey,
            treasury: treasuryWallet.publicKey,
          })
          .signers([userA])
          .rpc(),
        "WalletPaused",
      );
      expect(await connection.getBalance(solVaultPdaA)).to.equal(vaultBefore);
      expect(await connection.getBalance(treasuryWallet.publicKey)).to.equal(treasuryBefore);
      expect(await connection.getBalance(recipient.publicKey)).to.equal(0);
    });

    it("8.5 Should fail to send tokens while paused without changing token balances!", async () => {
      const walletBefore = (await getAccount(connection, walletAAta)).amount;
      const treasuryBefore = (await getAccount(connection, treasuryAta)).amount;
      const recipientBefore = (await getAccount(connection, recipientAta)).amount;

      await expectFailure(
        sendToken(userA, new anchor.BN(1_000), {
          mint,
          walletTokenAccount: walletAAta,
          recipientTokenAccount: recipientAta,
          treasuryTokenAccount: treasuryAta,
        }),
        "WalletPaused",
      );

      expect((await getAccount(connection, walletAAta)).amount).to.equal(walletBefore);
      expect((await getAccount(connection, treasuryAta)).amount).to.equal(treasuryBefore);
      expect((await getAccount(connection, recipientAta)).amount).to.equal(recipientBefore);
    });

    it("8.6 Admin unpauses and wallet creation works again!", async () => {
      await adminSetPaused(false);
      await createWallet(userC);
      const wallet = await program.account.userWallet.fetch(walletPdaC);
      expect(wallet.owner.toBase58()).to.equal(userC.publicKey.toBase58());
    });

    async function setVerificationForPauseTest() {
      // Move userA from Pending to Rejected so request_verification would
      // otherwise be allowed; only the pause check can make it fail.
      await program.methods
        .setVerification(VERIFICATION.rejected as any, 0, new anchor.BN(0), ZERO_HASH)
        .accountsPartial({ verifier: verifierWallet.publicKey, wallet: walletPdaA })
        .signers([verifierWallet])
        .rpc();
    }
  });
});
