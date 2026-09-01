import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.PI_CODING_AGENT_DIR = fileURLToPath(
	new URL("./fixtures", import.meta.url),
);

const { default: autoCompact } = await import("../extensions/compact.ts");

test("reports completion time, duration, usage, and cost", () => {
	const handlers = new Map();
	autoCompact({ on: (event, handler) => handlers.set(event, handler) });

	const notifications = [];
	handlers.get("session_compact")(
		{
			fromExtension: true,
			compactionEntry: {
				usage: {
					totalTokens: 12345,
					cost: { total: 0.0042 },
				},
			},
		},
		{
			ui: {
				notify: (message, level) => notifications.push({ message, level }),
			},
		},
	);

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0].level, "info");
	assert.match(
		notifications[0].message,
		/^Compacted successfully at \d{2}:\d{2}:\d{2} with test-provider\/test-model:high \(12,345 tokens, \$0\.0042, duration unavailable\)$/,
	);
});

test("does not claim compaction performed by Pi was performed by the extension", () => {
	const handlers = new Map();
	autoCompact({ on: (event, handler) => handlers.set(event, handler) });

	let notified = false;
	handlers.get("session_compact")(
		{ fromExtension: false, compactionEntry: {} },
		{ ui: { notify: () => (notified = true) } },
	);

	assert.equal(notified, false);
});
