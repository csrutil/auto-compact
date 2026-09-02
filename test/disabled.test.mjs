import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.PI_CODING_AGENT_DIR = fileURLToPath(
	new URL("./fixtures-disabled", import.meta.url),
);

const { default: autoCompact } = await import("../extensions/compact.ts");

test("a disabled compaction section registers no handlers", () => {
	const handlers = new Map();
	autoCompact({ on: (event, handler) => handlers.set(event, handler) });

	assert.equal(handlers.size, 0);
});
