import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.PI_CODING_AGENT_DIR = fileURLToPath(
	new URL("./fixtures-missing", import.meta.url),
);

test("a missing compaction section fails with a clear error", async () => {
	await assert.rejects(
		() => import("../extensions/compact.ts"),
		/"compaction" section/,
	);
});
