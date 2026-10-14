import { PublicKey } from "@solana/web3.js";

export interface WalletVerification {
  status: "none" | "pending" | "verified" | "rejected" | "revoked";
  expiresAtUnixSeconds: number;
}

export interface OnRampProvider {
  createSession(input: {
    destination: string;
    network: "solana";
    asset: "SOL" | "USDC";
    idempotencyKey: string;
  }): Promise<{ providerSessionId: string; redirectUrl: string }>;
}

export class OnRampUnavailableError extends Error {
  constructor() {
    super("On-ramp is disabled until the provider confirms Solana PDA delivery");
    this.name = "OnRampUnavailableError";
  }
}

export class GatedOnRampService {
  constructor(
    private readonly verificationForOwner: (owner: PublicKey) => Promise<WalletVerification>,
    private readonly provider: OnRampProvider,
    private readonly providerPdaDeliveryConfirmed = false,
  ) {}

  async createSession(input: {
    owner: PublicKey;
    destination: PublicKey;
    asset: "SOL" | "USDC";
    idempotencyKey: string;
    nowUnixSeconds?: number;
  }): Promise<{ providerSessionId: string; redirectUrl: string }> {
    if (!this.providerPdaDeliveryConfirmed) throw new OnRampUnavailableError();
    const verification = await this.verificationForOwner(input.owner);
    const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
    if (verification.status !== "verified" || verification.expiresAtUnixSeconds <= now) {
      throw new Error("An active verified attestation is required for fiat on-ramp");
    }
    if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required");
    return this.provider.createSession({
      destination: input.destination.toBase58(),
      network: "solana",
      asset: input.asset,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

