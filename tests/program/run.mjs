import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const testFile = path.join(root, "tests/program/wallet.test.ts");
const minimumRuntimeCases = 58;
if (!fs.existsSync(testFile)) {
  console.error(`Required runtime test file is missing: ${testFile}`);
  process.exit(1);
}

const mochaCli = path.join(root, "node_modules/ts-mocha/bin/ts-mocha");
const result = spawnSync(process.execPath, [
  mochaCli,
  "-p", "./tests/program/tsconfig.json",
  "-t", "1000000",
  "--forbid-pending",
  "--reporter", "json",
  "./tests/program/wallet.test.ts",
], { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 16 * 1024 * 1024 });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

const output = result.stdout ?? "";
if (result.status !== 0) {
  if (output) process.stderr.write(output);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

let report;
const jsonStart = output.lastIndexOf("\n{");
const reportStart = jsonStart >= 0 ? jsonStart + 1 : output.indexOf("{");
try {
  report = JSON.parse(output.slice(reportStart));
} catch {
  console.error("Runtime test runner returned success without a parseable Mocha report.");
  if (output) process.stderr.write(output);
  process.exit(1);
}

const stats = report.stats ?? {};
if (!Number.isInteger(stats.tests) || stats.tests < minimumRuntimeCases || stats.failures !== 0 || stats.pending !== 0) {
  console.error(`Runtime suite must execute at least ${minimumRuntimeCases} cases with no failures or pending tests (tests=${stats.tests}, failures=${stats.failures}, pending=${stats.pending}).`);
  if (output) process.stderr.write(output);
  process.exit(1);
}

const testLogs = output.slice(0, reportStart);
if (testLogs.trim()) process.stdout.write(testLogs);
console.log(`Runtime integration: ${stats.passes}/${stats.tests} tests passed; 0 failures; 0 pending.`);
