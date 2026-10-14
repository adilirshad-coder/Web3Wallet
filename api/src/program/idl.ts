import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Idl } from "@anchor-lang/core";

const idlPath = fileURLToPath(new URL("../../idl/wallet.json", import.meta.url));
export const walletIdl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as Idl;
