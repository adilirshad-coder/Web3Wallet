import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSignSubmit } from "@/lib/tx";

const { api, transaction } = vi.hoisted(() => ({
  api: { submit: vi.fn(), waitForStatus: vi.fn() },
  transaction: { serialize: vi.fn(() => Uint8Array.of(1)) },
}));
vi.mock("@/services/apiService", () => ({ apiService: api }));
vi.mock("@solana/web3.js", () => ({ VersionedTransaction: { deserialize: vi.fn(() => transaction) } }));

afterEach(() => vi.resetAllMocks());

function buildResponse() {
  return {
    transaction: "AQ==",
    encoding: "base64" as const,
    version: 0 as const,
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 100,
    feePayer: "owner",
    instructions: [],
    simulation: { unitsConsumed: 100 },
    cost: { networkFeeLamports: "5000", rentLamports: "0", protocolFee: { amount: "0", mint: null } },
  };
}

describe("build, sign, submit, confirm transaction flow", () => {
  it("reports success only after the backend returns confirmed status", async () => {
    const built = buildResponse();
    api.submit.mockResolvedValue({ signature: "sig" });
    api.waitForStatus.mockResolvedValue({ status: "confirmed" });
    const signature = await buildSignSubmit(
      async () => built,
      async (tx) => tx,
      () => {},
    );
    expect(signature).toBe("sig");
    expect(api.submit).toHaveBeenCalledOnce();
    expect(api.waitForStatus).toHaveBeenCalledWith("sig");
  });

  it("does not submit if the user rejects signing", async () => {
    api.submit.mockResolvedValue({ signature: "sig" });
    const built = buildResponse();
    await expect(buildSignSubmit(async () => built, async () => { throw new Error("User rejected"); }, () => {})).rejects.toThrow("User rejected");
    expect(api.submit).not.toHaveBeenCalled();
  });

  it("does not report success for a failed on-chain transaction", async () => {
    const built = buildResponse();
    api.submit.mockResolvedValue({ signature: "sig" });
    api.waitForStatus.mockResolvedValue({ status: "failed", error: "program error" });
    await expect(buildSignSubmit(async () => built, async (tx) => tx, () => {})).rejects.toThrow("program error");
  });
});
