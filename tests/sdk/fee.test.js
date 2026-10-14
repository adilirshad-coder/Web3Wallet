import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { calculateFee } from "../../sdk/dist/index.js";

const vectors = JSON.parse(fs.readFileSync(new URL("../vectors/fee.json", import.meta.url), "utf8"));

test("fee calculation matches shared vectors", () => {
  for (const vector of vectors) {
    if (vector.error === "overflow") {
      assert.throws(() => calculateFee(vector.amount, vector.bps), { message: "MathOverflow" }, vector.name);
    } else if (vector.error === "invalid_limits") {
      assert.throws(() => calculateFee(vector.amount, vector.bps), { message: "InvalidLimits" }, vector.name);
    } else {
      assert.deepEqual(calculateFee(vector.amount, vector.bps), {
        amount: vector.amount,
        fee: vector.fee,
        totalDebit: vector.totalDebit,
        feeBps: vector.bps,
        rounding: "ceil",
      }, vector.name);
    }
  }
});
