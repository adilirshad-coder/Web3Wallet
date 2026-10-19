import { describe, expect, it } from "vitest";
import { CLUSTER, RPC_URL, TOKENS, toBaseUnits } from "@/lib/solana";

describe("local Solana configuration and amount conversion", () => {
  it("defaults the frontend to the local validator and native SOL only", () => {
    expect(CLUSTER).toBe("localnet");
    expect(RPC_URL).toBe("http://127.0.0.1:8899");
    expect(TOKENS.map((token) => token.symbol)).toEqual(["SOL"]);
  });

  it("converts exact decimal amounts without floating point", () => {
    expect(toBaseUnits("1.000000001", 9)).toBe("1000000001");
    expect(() => toBaseUnits("1.0000000001", 9)).toThrow(/decimal places/);
    expect(() => toBaseUnits("0", 9)).toThrow(/greater than zero/);
    expect(() => toBaseUnits("-1", 9)).toThrow(/valid positive amount/);
  });
});
