/**
 * The prep commands and what the server's answers to them mean. Each is safe to send twice: a tick sets a status (the
 * server answers a task already there with 200), the session is made under an id the phone chose (a repeat answers 200
 * with the stored row), saving selections replaces them, and generate carries a `requestId` (a repeat answers with the
 * stored tasks and rebuilds nothing, so ticks survive). No server answer means "already applied" here: a 409 is always a
 * real refusal (`PREP_SESSION_ENDED`, `CONFLICT`), so it stays on screen.
 *
 * A tick is keyed by its task and only the newest matters (`latestOnly`): tick, untick, skip, quickly, sends one request.
 * The plan (create, selections, generate) shares the session's key, so it is sent in that order and a refused create
 * takes the rest of the plan with it when the cook discards it.
 */

import type { PrepSelectionInput } from "@culinaire/shared/schemas/prep";
import type { ApiClient } from "../api/client";
import type { CommandHandler } from "../outbox/outbox";

export type PrepTickStatus = "pending" | "completed" | "skipped";

export interface PrepTickCommand {
  prepTaskId: string;
  prepSessionId: string;
  /** The ingredient, for the sync list. */
  label: string;
  status: PrepTickStatus;
  /** ISO, the phone's clock when the cook ticked it; null for an untick or a skip. */
  completedAt: string | null;
}

export interface PrepCreateCommand {
  /** Made on the phone; the server stores the session under it. */
  prepSessionId: string;
  /** Where the prep is for: a plan sent after a location switch still lands here. */
  storeLocationId: string;
  /** `YYYY-MM-DD`, the phone's local date. */
  prepDate: string;
  expectedCovers: number | null;
}

export interface PrepSelectionsCommand {
  prepSessionId: string;
  selections: PrepSelectionInput[];
}

export interface PrepGenerateCommand {
  prepSessionId: string;
  requestId: string;
}

export const PREP_TICK = "prep.tick";
export const PREP_CREATE = "prep.create";
export const PREP_SELECTIONS = "prep.selections";
export const PREP_GENERATE = "prep.generate";
export const PREP_TYPES = [PREP_TICK, PREP_CREATE, PREP_SELECTIONS, PREP_GENERATE];

const MAX_SERVER_FAILURES = 5;
const sessionKey = (c: { prepSessionId: string }) => `prep-session:${c.prepSessionId}`;

/** A newer command of the same type replaces an unsent one, unless the older may be on the server; anything else goes after it. */
const replaceSameType = (type: string): NonNullable<CommandHandler<unknown>["fold"]> => (open, incoming, mayBeOnServer) =>
  !mayBeOnServer && open.type === type ? { type, command: incoming } : "append";

const TICK_WORDS: Record<PrepTickStatus, string> = { completed: "done", pending: "back to to-do", skipped: "skipped" };

export function prepHandlers(client: ApiClient): CommandHandler<unknown>[] {
  const tick: CommandHandler<PrepTickCommand> = {
    type: PREP_TICK,
    version: 1,
    key: (c) => `prep-task:${c.prepTaskId}`,
    latestOnly: true,
    maxServerFailures: MAX_SERVER_FAILURES,
    async send(c) {
      const body: Record<string, unknown> = { status: c.status };
      if (c.status === "completed" && c.completedAt) body.completedAt = c.completedAt;
      await client.request("PATCH", `/api/prep/tasks/${encodeURIComponent(c.prepTaskId)}`, { body });
    },
    describe: (c) => `Prep: ${c.label} ${TICK_WORDS[c.status]}`,
  };
  const create: CommandHandler<PrepCreateCommand> = {
    type: PREP_CREATE,
    version: 1,
    key: sessionKey,
    creates: true,
    maxServerFailures: MAX_SERVER_FAILURES,
    async send(c) {
      const body: Record<string, unknown> = { prepSessionId: c.prepSessionId, storeLocationId: c.storeLocationId, prepDate: c.prepDate };
      if (c.expectedCovers !== null) body.expectedCovers = c.expectedCovers;
      await client.request("POST", "/api/prep/sessions", { body });
    },
    describe: (c) => `Start prep for ${c.prepDate}`,
  };
  const selections: CommandHandler<PrepSelectionsCommand> = {
    type: PREP_SELECTIONS,
    version: 1,
    key: sessionKey,
    maxServerFailures: MAX_SERVER_FAILURES,
    fold: replaceSameType(PREP_SELECTIONS),
    async send(c) {
      await client.request("POST", `/api/prep/sessions/${encodeURIComponent(c.prepSessionId)}/selections`, { body: { selections: c.selections } });
    },
    describe: (c) => `Dishes for prep (${c.selections.length})`,
  };
  const generate: CommandHandler<PrepGenerateCommand> = {
    type: PREP_GENERATE,
    version: 1,
    key: sessionKey,
    maxServerFailures: MAX_SERVER_FAILURES,
    fold: replaceSameType(PREP_GENERATE),
    async send(c) {
      await client.request("POST", `/api/prep/sessions/${encodeURIComponent(c.prepSessionId)}/generate`, { body: { requestId: c.requestId } });
    },
    describe: () => "Make today's prep list",
  };
  return [tick, create, selections, generate] as CommandHandler<unknown>[];
}
