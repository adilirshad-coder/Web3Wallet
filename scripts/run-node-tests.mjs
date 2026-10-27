import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const testPaths = process.argv.slice(2);
if (testPaths.length === 0) {
  console.error("Usage: node scripts/run-node-tests.mjs <required-test-file> [...required-test-files]");
  process.exit(1);
}

const absoluteTestPaths = testPaths.map((testPath) => path.resolve(process.cwd(), testPath));
for (const absoluteTestPath of absoluteTestPaths) {
  if (!fs.existsSync(absoluteTestPath)) {
    console.error(`Required test file is missing: ${absoluteTestPath}`);
    process.exit(1);
  }
}

const result = spawnSync(process.execPath, [
  "--test",
  "--test-reporter=tap",
  ...absoluteTestPaths,
], { cwd: process.cwd(), encoding: "utf8", env: process.env, maxBuffer: 8 * 1024 * 1024 });

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

const count = (name) => Number(output.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1]);
const tests = count("tests");
const failures = count("fail");
const skipped = count("skipped");
const cancelled = count("cancelled");
const todo = count("todo");
if (!Number.isInteger(tests) || tests < 1 || failures !== 0 || skipped !== 0 || cancelled !== 0 || todo !== 0) {
  console.error(`Test run must discover and pass tests with none skipped, cancelled, or todo (tests=${tests}, failures=${failures}, skipped=${skipped}, cancelled=${cancelled}, todo=${todo}).`);
  if (output) process.stderr.write(output);
  process.exit(1);
}

process.stdout.write(output);
