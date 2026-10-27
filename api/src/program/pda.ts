import { PublicKey } from "@solana/web3.js";
import type { Idl } from "@anchor-lang/core";

type IdlSeed = { kind: string; value?: number[]; path?: string };
type IdlAccount = { name: string; pda?: { seeds: IdlSeed[] } };

export function deriveIdlPda(
  idl: Idl,
  instructionName: string,
  accountName: string,
  accounts: Record<string, PublicKey>,
  programId: PublicKey,
): PublicKey {
  const instruction = (idl.instructions as unknown as Array<{ name: string; accounts: IdlAccount[] }>).find((item) => item.name === instructionName);
  const account = instruction?.accounts.find((item) => item.name === accountName);
  if (!account?.pda) throw new Error(`IDL does not define PDA ${instructionName}.${accountName}`);
  const seeds = account.pda.seeds.map((seed) => {
    if (seed.kind === "const" && seed.value) return Buffer.from(seed.value);
    if (seed.kind === "account" && seed.path) {
      const key = accounts[seed.path.split(".").at(-1)!];
      if (!key) throw new Error(`Missing IDL PDA seed account ${seed.path}`);
      return key.toBuffer();
    }
    throw new Error(`Unsupported IDL PDA seed for ${instructionName}.${accountName}`);
  });
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}
