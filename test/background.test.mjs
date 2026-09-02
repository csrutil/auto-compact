import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.PI_CODING_AGENT_DIR = fileURLToPath(
	new URL("./fixtures-background", import.meta.url),
);

const { default: autoCompact } = await import("../extensions/compact.ts");

// One shared extension instance: the module keeps job state across handlers,
// matching how Pi runs a single extension per session.
const notifications = [];
const handlers = new Map();
autoCompact({ on: (event, handler) => handlers.set(event, handler) });

let usage = { tokens: 0, percent: 0 };
let completion = { stopReason: "stop", content: [], usage: {} };
let completeCalls = 0;
let compacts = 0;

const okCompletion = (text) => ({
	stopReason: "stop",
	content: [{ type: "text", text }],
	usage: { totalTokens: 100, cost: { total: 0 } },
});

// Six ~400-token user messages; keepRecentTokens (250) cuts inside the
// branch, so the background job has history to summarize.
const entries = Array.from({ length: 6 }, (_, i) => ({
	type: "message",
	id: `e${i}`,
	parentId: null,
	timestamp: new Date().toISOString(),
	message: { role: "user", content: [{ type: "text", text: "x".repeat(400) }] },
}));

const dummyPreparation = () => ({
	firstKeptEntryId: "kept-1",
	messagesToSummarize: [
		{ role: "user", content: [{ type: "text", text: "hello" }] },
	],
	turnPrefixMessages: [],
	isSplitTurn: false,
	tokensBefore: 1000,
	previousSummary: undefined,
	fileOps: { read: new Set(), written: new Set(), edited: new Set() },
	settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 16384 },
});

function makeCtx({ leafId = "leaf-1", branch = entries } = {}) {
	return {
		getContextUsage: () => usage,
		sessionManager: {
			getSessionId: () => "session-1",
			getLeafId: () => leafId,
			getBranch: () => branch,
		},
		modelRegistry: {
			find: () => ({ maxTokens: 8192, reasoning: false }),
			complete: async () => {
				completeCalls += 1;
				return completion;
			},
		},
		compact: () => {
			compacts += 1;
		},
		ui: { notify: (message, level) => notifications.push({ message, level }) },
	};
}

const flush = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition, ms = 2000) {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
		await flush(5);
	}
}

const lastNotify = (pattern) =>
	notifications.filter((n) => pattern.test(n.message)).at(-1);

test("below the threshold no background compaction starts", async () => {
	notifications.length = 0;
	usage = { tokens: 100, percent: 10 };
	handlers.get("agent_end")({}, makeCtx());
	await flush(20);
	assert.equal(notifications.length, 0);
	assert.equal(completeCalls, 0);
});

test("above the threshold the background compaction starts", async () => {
	notifications.length = 0;
	usage = { tokens: 5000, percent: 90 };
	handlers.get("agent_end")({}, makeCtx());
	assert.ok(lastNotify(/^Pre-compacting with test-provider\/test-model:high$/));
	await until(() => completeCalls >= 1);
	await flush(20); // let the promise chain record the result
});

test("settled does not compact while the leaf is unchanged", () => {
	compacts = 0;
	handlers.get("agent_settled")({}, makeCtx({ leafId: "leaf-1" }));
	assert.equal(compacts, 0);
});

test("settled compacts once the leaf advances", () => {
	handlers.get("agent_settled")({}, makeCtx({ leafId: "leaf-2" }));
	assert.equal(compacts, 1);
});

test("an incomplete model response fails loudly and clears the job", async () => {
	notifications.length = 0;
	handlers.get("session_start")({}, makeCtx()); // reset job state
	completion = { stopReason: "pending", content: [], usage: {} };
	usage = { tokens: 5000, percent: 90 };
	handlers.get("agent_end")({}, makeCtx());
	await until(() =>
		notifications.some(
			(n) =>
				n.level === "warning" && /incomplete response/.test(n.message),
		),
	);
	// the failed job must not block the next one
	handlers.get("session_start")({}, makeCtx());
	completion = okCompletion("bg summary");
	handlers.get("agent_end")({}, makeCtx());
	await until(() => completeCalls >= 3); // pending attempt + retry job
	await flush(20);
});

test("a matching manual compaction reuses the background result and clears the job", async () => {
	notifications.length = 0;
	const callsBefore = completeCalls;
	const event = {
		customInstructions: undefined,
		branchEntries: entries,
		preparation: dummyPreparation(),
		signal: AbortSignal.none,
	};
	const result = await handlers.get("session_before_compact")(event, makeCtx());
	assert.match(result.compaction.summary, /bg summary/);
	assert.equal(completeCalls, callsBefore); // no second model call
	assert.equal(lastNotify(/^Compacting with /), undefined);

	// the consumed job must not block a new background compaction
	notifications.length = 0;
	usage = { tokens: 5000, percent: 90 };
	handlers.get("agent_end")({}, makeCtx());
	assert.ok(lastNotify(/^Pre-compacting with /));
	await until(() => completeCalls >= callsBefore + 1);
	await flush(20);
});

test("custom instructions fall back to a foreground compaction", async () => {
	notifications.length = 0;
	completion = okCompletion("fg summary");
	const event = {
		customInstructions: "focus on tests",
		branchEntries: entries,
		preparation: dummyPreparation(),
		signal: AbortSignal.none,
	};
	const result = await handlers.get("session_before_compact")(event, makeCtx());
	assert.match(result.compaction.summary, /fg summary/);
	assert.ok(lastNotify(/^Compacting with test-provider\/test-model:high$/));
});

test("a stale branch falls back to a foreground compaction", async () => {
	notifications.length = 0;
	completion = okCompletion("fg summary 2");
	const event = {
		customInstructions: undefined,
		branchEntries: [],
		preparation: dummyPreparation(),
		signal: AbortSignal.none,
	};
	const result = await handlers.get("session_before_compact")(event, makeCtx());
	assert.match(result.compaction.summary, /fg summary 2/);
	assert.ok(lastNotify(/^Compacting with test-provider\/test-model:high$/));
});
