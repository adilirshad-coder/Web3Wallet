import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PublicKey } from "@solana/web3.js";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const sourcePath = path.join(root, "programs/wallet/src/lib.rs");
const anchorPath = path.join(root, "Anchor.toml");
const artifactPath = path.join(root, "target/deploy/wallet.so");
const idlPath = path.join(root, "target/idl/wallet.json");
const apiIdlPath = path.join(root, "api/idl/wallet.json");
const generatedTypePath = path.join(root, "target/types/wallet.ts");
const keypairPath = path.join(root, "target/deploy/wallet-keypair.json");

function fail(message) {
  console.error(`Program build verification failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(artifactPath)) fail("target/deploy/wallet.so is missing; run anchor build first");
if (!fs.existsSync(idlPath)) fail("target/idl/wallet.json is missing; run anchor build first");
if (!fs.existsSync(apiIdlPath)) fail("api/idl/wallet.json is missing; copy target/idl/wallet.json after anchor build");
if (!fs.existsSync(generatedTypePath)) fail("target/types/wallet.ts is missing; run anchor build first");

const source = fs.readFileSync(sourcePath, "utf8");
const sourceId = source.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)?.[1];
const config = fs.readFileSync(anchorPath, "utf8");
const configId = config.match(/^\s*wallet\s*=\s*"([1-9A-HJ-NP-Za-km-z]+)"/m)?.[1];
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const apiIdl = JSON.parse(fs.readFileSync(apiIdlPath, "utf8"));
if (JSON.stringify(apiIdl) !== JSON.stringify(idl)) {
  fail("api/idl/wallet.json differs from target/idl/wallet.json; copy the current generated IDL");
}
const idlId = idl.address;
const typeSource = fs.readFileSync(generatedTypePath, "utf8");
const typeId = typeSource.match(/"address":\s*"([1-9A-HJ-NP-Za-km-z]+)"/)?.[1];
const ids = [sourceId, configId, idlId, typeId];
if (ids.some((id) => !id) || new Set(ids).size !== 1) {
  fail(`program IDs disagree (source=${sourceId}, Anchor.toml=${configId}, IDL=${idlId}, generated type=${typeId})`);
}
const artifactBytes = fs.readFileSync(artifactPath);
if (!artifactBytes.includes(new PublicKey(sourceId).toBuffer())) {
  fail(`compiled SBF artifact does not contain the declared program ID bytes (${sourceId}); rebuild it`);
}

const sourceFiles = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name.endsWith(".rs") || entry.name === "Cargo.toml") sourceFiles.push(full);
  }
}
visit(path.join(root, "programs/wallet/src"));
sourceFiles.push(
  path.join(root, "programs/wallet/Cargo.toml"),
  path.join(root, "Cargo.toml"),
  path.join(root, "Anchor.toml"),
  path.join(root, "Cargo.lock"),
);
const newestSource = Math.max(...sourceFiles.map((file) => fs.statSync(file).mtimeMs));
if (fs.statSync(artifactPath).mtimeMs < newestSource) {
  fail("wallet.so predates current program sources or manifests; rebuild before runtime tests");
}

if (fs.existsSync(keypairPath)) {
  let keypair;
  try {
    keypair = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  } catch {
    fail("wallet program keypair file is not valid JSON");
  }
  if (!Array.isArray(keypair) || keypair.length !== 64 || keypair.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    fail("wallet program keypair file has an invalid format");
  }
  const keypairId = new PublicKey(Buffer.from(keypair.slice(32))).toBase58();
  if (keypairId !== sourceId) fail(`program keypair public key (${keypairId}) does not match the declared ID`);
} else if (args.has("--require-keypair") || !args.has("--allow-missing-keypair")) {
  fail("target/deploy/wallet-keypair.json is missing; use --allow-missing-keypair only for local runtime loading without a deploy identity");
} else {
  console.warn("Program keypair absent; static source/config/IDL IDs are consistent. Runtime loading does not require a deploy keypair.");
}

console.log(`Verified fresh wallet SBF artifact and program ID ${sourceId}`);
