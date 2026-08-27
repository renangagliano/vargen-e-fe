import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Admin login always clears pending state after initialization or authentication failure", async () => {
  const source = await readFile(new URL("./login-form.tsx", import.meta.url), "utf8");
  assert.match(source, /finally\s*\{\s*setPending\(false\);\s*\}/);
});
