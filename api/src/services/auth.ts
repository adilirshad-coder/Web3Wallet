import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { ApiError } from "../errors.js";

export interface ChallengeRecord { owner: string; nonce: string; message: string; expiresAt: number }
export interface SessionRecord { owner: string; expiresAt: number }
export interface SessionStore {
  putChallenge(record: ChallengeRecord): Promise<void>;
  takeLatestChallenge(owner: string): Promise<ChallengeRecord | undefined>;
  putSession(token: string, record: SessionRecord): Promise<void>;
  getSession(token: string): Promise<SessionRecord | undefined>;
  deleteSession(token: string): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  async putChallenge(record: ChallengeRecord) {
    for (const [key, value] of this.challenges) if (value.expiresAt <= Date.now()) this.challenges.delete(key);
    this.challenges.set(`${record.owner}:${record.nonce}`, record);
  }
  async takeLatestChallenge(owner: string) {
    const matches = [...this.challenges.entries()].filter(([, value]) => value.owner === owner).sort((a, b) => b[1].expiresAt - a[1].expiresAt);
    const selected = matches[0];
    if (!selected) return undefined;
    for (const [key] of matches) this.challenges.delete(key);
    return selected[1];
  }
  async putSession(token: string, record: SessionRecord) { this.sessions.set(token, record); }
  async getSession(token: string) {
    const value = this.sessions.get(token);
    if (value && value.expiresAt <= Date.now()) this.sessions.delete(token);
    return value;
  }
  async deleteSession(token: string) { this.sessions.delete(token); }
}

export interface AuthService {
  challenge(owner: string): Promise<{ nonce: string; message: string; expiresAt: string }>;
  verify(owner: string, signature: string): Promise<{ token: string; expiresAt: string }>;
  authenticate(token: string): Promise<string>;
  readonly store: SessionStore;
}

export function createAuthService(cluster: string, store: SessionStore = new MemorySessionStore(), now = () => Date.now()): AuthService {
  return {
    store,
    async challenge(owner) {
      let publicKey: PublicKey;
      try { publicKey = new PublicKey(owner); } catch { throw new ApiError(400, "validation_error", "Owner must be a valid wallet address"); }
      const issuedAt = now();
      const expiresAt = issuedAt + 5 * 60_000;
      const nonce = randomBytes(24).toString("base64url");
      const message = ["WalletWeb3 authentication", `cluster: ${cluster}`, `owner: ${publicKey.toBase58()}`, `nonce: ${nonce}`, `issuedAt: ${new Date(issuedAt).toISOString()}`, `expiresAt: ${new Date(expiresAt).toISOString()}`].join("\n");
      const record = { owner: publicKey.toBase58(), nonce, message, expiresAt };
      await store.putChallenge(record);
      return { nonce, message, expiresAt: new Date(expiresAt).toISOString() };
    },
    async verify(owner, signature) {
      const consumed = await store.takeLatestChallenge(owner);
      if (!consumed) throw new ApiError(401, "challenge_invalid", "A current wallet signature challenge is required");
      if (consumed.expiresAt <= now()) throw new ApiError(401, "challenge_expired", "The wallet signature challenge expired");
      let bytes: Buffer;
      try { bytes = Buffer.from(signature, "base64"); } catch { throw new ApiError(401, "invalid_signature", "The wallet signature is invalid"); }
      if (bytes.length !== 64 || bytes.toString("base64") !== signature || !nacl.sign.detached.verify(Buffer.from(consumed.message), bytes, new PublicKey(owner).toBytes())) {
        throw new ApiError(401, "invalid_signature", "The wallet signature is invalid");
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = now() + 15 * 60_000;
      await store.putSession(token, { owner, expiresAt });
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },
    async authenticate(token) {
      const record = await store.getSession(token);
      if (!record || record.expiresAt <= now()) {
        if (record) await store.deleteSession(token);
        throw new ApiError(401, "session_invalid", "The session is missing or expired");
      }
      return record.owner;
    },
  };
}
