import {
  createAssistantMessageEventStream,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import {
  compact,
  type ExtensionAPI,
  type ExtensionContext,
  findCutPoint,
  getAgentDir,
  type SessionEntry,
  sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Settings {
  compaction: {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
    provider: string;
    model: string;
    thinkingLevel?: ModelThinkingLevel;
    backgroundThreshold: number;
  };
}

const settings = JSON.parse(
  readFileSync(join(getAgentDir(), "settings.json"), "utf8"),
) as Settings;
const {
  provider: PROVIDER,
  model: MODEL,
  thinkingLevel: THINKING_LEVEL = "high",
  backgroundThreshold: BACKGROUND_THRESHOLD,
  ...COMPACTION_SETTINGS
} = settings.compaction;

interface CompactionJob {
  sessionId: string;
  startedAtLeafId: string | null;
  firstKeptEntryId: string;
  controller: AbortController;
  promise: Promise<Awaited<ReturnType<typeof compact>> | undefined>;
  result?: Awaited<ReturnType<typeof compact>>;
}

let job: CompactionJob | undefined;

function prepareBackgroundCompaction(
  entries: SessionEntry[],
  tokensBefore: number,
): Parameters<typeof compact>[0] | undefined {
  if (entries.at(-1)?.type === "compaction") return;

  let previousCompactionIndex = -1;
  let previousCompaction:
    | Extract<SessionEntry, { type: "compaction" }>
    | undefined;
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type === "compaction") {
      previousCompactionIndex = index;
      previousCompaction = entry;
      break;
    }
  }

  const previousBoundary = previousCompaction
    ? entries.findIndex(
        (entry) => entry.id === previousCompaction.firstKeptEntryId,
      )
    : -1;
  const boundaryStart = previousCompaction
    ? previousBoundary >= 0
      ? previousBoundary
      : previousCompactionIndex + 1
    : 0;
  const cutPoint = findCutPoint(
    entries,
    boundaryStart,
    entries.length,
    COMPACTION_SETTINGS.keepRecentTokens,
  );
  const firstKeptEntry = entries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) return;

  const historyEnd = cutPoint.isSplitTurn
    ? cutPoint.turnStartIndex
    : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize = entries
    .slice(boundaryStart, historyEnd)
    .filter((entry) => entry.type !== "compaction")
    .flatMap((entry) => sessionEntryToContextMessages(entry).slice(0, 1));
  const turnPrefixMessages = cutPoint.isSplitTurn
    ? entries
        .slice(cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
        .filter((entry) => entry.type !== "compaction")
        .flatMap((entry) => sessionEntryToContextMessages(entry).slice(0, 1))
    : [];
  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0)
    return;

  const fileOps = {
    read: new Set<string>(),
    written: new Set<string>(),
    edited: new Set<string>(),
  };
  const previousDetails = previousCompaction?.details;
  if (
    previousCompaction &&
    !previousCompaction.fromHook &&
    typeof previousDetails === "object" &&
    previousDetails
  ) {
    if (
      "readFiles" in previousDetails &&
      Array.isArray(previousDetails.readFiles)
    ) {
      for (const path of previousDetails.readFiles) {
        if (typeof path === "string") fileOps.read.add(path);
      }
    }
    if (
      "modifiedFiles" in previousDetails &&
      Array.isArray(previousDetails.modifiedFiles)
    ) {
      for (const path of previousDetails.modifiedFiles) {
        if (typeof path === "string") fileOps.edited.add(path);
      }
    }
  }
  for (const message of [...messagesToSummarize, ...turnPrefixMessages]) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const args = block.arguments as Record<string, unknown> | undefined;
      const path =
        args && typeof args.path === "string" ? args.path : undefined;
      if (!path) continue;
      if (block.name === "read") fileOps.read.add(path);
      if (block.name === "write") fileOps.written.add(path);
      if (block.name === "edit") fileOps.edited.add(path);
    }
  }

  return {
    firstKeptEntryId: firstKeptEntry.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    previousSummary: previousCompaction?.summary,
    fileOps,
    settings: COMPACTION_SETTINGS,
  };
}

export default function (pi: ExtensionAPI) {
  const reset = () => {
    job?.controller.abort();
    job = undefined;
  };

  const runCompaction = async (
    preparation: Parameters<typeof compact>[0],
    ctx: ExtensionContext,
    customInstructions?: string,
    signal?: AbortSignal,
  ) => {
    const model = ctx.modelRegistry.find(PROVIDER, MODEL);
    if (!model) {
      throw new Error(`Compaction model ${PROVIDER}/${MODEL} is unavailable`);
    }

    return compact(
      preparation,
      model,
      undefined,
      undefined,
      customInstructions,
      signal,
      THINKING_LEVEL,
      async (requestModel, context, options) => {
        const response = await ctx.modelRegistry.complete(
          requestModel,
          context,
          options,
        );
        if (response.stopReason === "pending") {
          throw new Error("Compaction model returned an incomplete response");
        }
        const stream = createAssistantMessageEventStream();
        if (
          response.stopReason === "aborted" ||
          response.stopReason === "error"
        ) {
          stream.push({
            type: "error",
            reason: response.stopReason,
            error: response,
          });
        } else {
          stream.push({
            type: "done",
            reason: response.stopReason,
            message: response,
          });
        }
        return stream;
      },
    );
  };

  pi.on("agent_end", (_event, ctx) => {
    const usage = ctx.getContextUsage();
    if (
      !usage ||
      usage.tokens === null ||
      usage.percent === null ||
      usage.percent < BACKGROUND_THRESHOLD
    )
      return;

    const sessionId = ctx.sessionManager.getSessionId();
    if (job?.sessionId === sessionId) return;
    reset();

    const preparation = prepareBackgroundCompaction(
      ctx.sessionManager.getBranch(),
      usage.tokens,
    );
    if (!preparation) return;

    const controller = new AbortController();
    const promise = runCompaction(
      preparation,
      ctx,
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (job?.promise === promise) job.result = result;
        return result;
      })
      .catch((error) => {
        if (job?.promise === promise) job = undefined;
        if (!controller.signal.aborted) {
          const message =
            error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Background compaction failed: ${message}`, "warning");
        }
        return undefined;
      });

    job = {
      sessionId,
      startedAtLeafId: ctx.sessionManager.getLeafId(),
      firstKeptEntryId: preparation.firstKeptEntryId,
      controller,
      promise,
    };
    ctx.ui.notify(
      `Pre-compacting with ${PROVIDER}/${MODEL}:${THINKING_LEVEL}`,
      "info",
    );
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (
      job?.result &&
      job.sessionId === ctx.sessionManager.getSessionId() &&
      job.startedAtLeafId !== ctx.sessionManager.getLeafId()
    ) {
      ctx.compact();
    }
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const cachedJob = job?.sessionId === sessionId ? job : undefined;
    const cacheIsUsable =
      !event.customInstructions &&
      cachedJob &&
      event.branchEntries.some(
        (entry) => entry.id === cachedJob.firstKeptEntryId,
      );

    if (cacheIsUsable) {
      const result = cachedJob.result ?? (await cachedJob.promise);
      if (result) {
        job = undefined;
        return { compaction: result };
      }
    }

    reset();
    ctx.ui.notify(
      `Compacting with ${PROVIDER}/${MODEL}:${THINKING_LEVEL}`,
      "info",
    );

    try {
      return {
        compaction: await runCompaction(
          event.preparation,
          ctx,
          event.customInstructions,
          event.signal,
        ),
      };
    } catch (error) {
      if (!event.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Custom compaction failed: ${message}; using the active model`,
          "warning",
        );
      }
      return;
    }
  });

  pi.on("session_compact", () => reset());
  pi.on("session_start", () => reset());
  pi.on("session_shutdown", () => reset());
}
