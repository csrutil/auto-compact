import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.PI_CODING_AGENT_DIR = fileURLToPath(
	new URL("./fixtures-missing", import.meta.url),
);

const { default: autoCompact } = await import("../extensions/compact.ts");

test("a missing compaction section stays inactive with a notice", () => {
	const handlers = new Map();
	autoCompact({ on: (event, handler) => handlers.set(event, handler) });

	assert.equal(handlers.get("agent_end"), undefined);

	const notifications = [];
	handlers.get("session_start")(
		{},
		{ ui: { notify: (message, level) => notifications.push({ message, level }) } },
	);

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "info");
	assert.match(
		notifications[0].message,
		/auto-compact inactive: no "compaction" section in settings\.json/,
	);
});
