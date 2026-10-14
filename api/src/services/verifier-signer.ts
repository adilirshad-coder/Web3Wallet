import fs from "node:fs";
import { BN, Program } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { ApiConfig } from "../config.js";
import { walletIdl } from "../program/idl.js";
import { deriveIdlPda } from "../program/pda.js";

export interface ApprovedAttestation {
  owner: string;
  level: number;
  expiresAt: string;
  attestationHash: string;
}

export interface VerifierSigner {
  setVerification(attestation: ApprovedAttestation): Promise<string>;
}

export class LocalKeypairSigner implements VerifierSigner {
  private constructor(private readonly keypair: Keypair, private readonly config: ApiConfig) {}

  static fromPath(path: string, config: ApiConfig): LocalKeypairSigner {
    if (config.cluster === "mainnet-beta") throw new Error("Local verifier keypairs are not allowed on mainnet-beta");
    const raw = JSON.parse(fs.readFileSync(path, "utf8"));
    if (!Array.isArray(raw) || raw.length !== 64 || raw.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error("Verifier keypair file is invalid");
    return new LocalKeypairSigner(Keypair.fromSecretKey(Uint8Array.from(raw)), config);
  }

  async setVerification(attestation: ApprovedAttestation): Promise<string> {
    const connection = new Connection(this.config.rpcUrl, { commitment: this.config.commitment });
    const program = new Program(walletIdl, { connection }) as Program<any>;
    const owner = new PublicKey(attestation.owner);
    const wallet = deriveIdlPda(walletIdl, "create_wallet", "wallet", { owner }, this.config.programId);
    const hash = Buffer.from(attestation.attestationHash, "hex");
    if (hash.length !== 32) throw new Error("Attestation hash must be 32 bytes");
    const instruction = await program.methods.setVerification({ verified: {} }, attestation.level, new BN(attestation.expiresAt), [...hash]).accountsPartial({ verifier: this.keypair.publicKey, wallet }).instruction();
    const latest = await connection.getLatestBlockhash(this.config.commitment);
    const message = new TransactionMessage({ payerKey: this.keypair.publicKey, recentBlockhash: latest.blockhash, instructions: [instruction] }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    transaction.sign([this.keypair]);
    return connection.sendRawTransaction(transaction.serialize(), { maxRetries: 0 });
  }
}

export class KmsVerifierSignerStub implements VerifierSigner {
  async setVerification(_attestation: ApprovedAttestation): Promise<string> {
    throw new Error("KMS verifier signing is not configured; integrate the provider SDK in the background worker");
  }
}
