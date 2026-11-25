/** What the Bench says and who may do what in it. Pure. */

import type { BenchMessage, BenchPerson } from "@culinaire/shared/schemas/bench";
import type { AuthUser } from "../api/auth";
import type { Room } from "./benchApi";

/** The web's reactions, by the key the server stores. */
export const EMOJI = [
  { key: "fire", display: "🔥", label: "Fire" },
  { key: "chef", display: "👨‍🍳", label: "Chef" },
  { key: "thumbsup", display: "👍", label: "Thumbs up" },
  { key: "heart", display: "❤️", label: "Heart" },
  { key: "clap", display: "👏", label: "Clap" },
  { key: "hundred", display: "💯", label: "Hundred" },
  { key: "eyes", display: "👀", label: "Eyes" },
  { key: "sparkles", display: "✨", label: "Sparkles" },
] as const;

export const emojiOf = (key: string) => EMOJI.find((e) => e.key === key)?.display ?? key;
export const emojiLabel = (key: string) => EMOJI.find((e) => e.key === key)?.label ?? key;

/** The web's words where an administrator has not written a channel's own. */
export const DEFAULT_BANNER = {
  global: "This is the public channel, open to all registered chefs. Keep it professional and supportive.",
  organisation: "This is your organisation's private channel. Only members of your team can see these messages.",
};

export function dayLabel(iso: string, now: number): string {
  const day = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day.toDateString() === new Date(now).toDateString()) return "Today";
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
}

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function typingText(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is writing…`;
  return names.length === 2 ? `${names[0]} and ${names[1]} are writing…` : `${names[0]} and ${names.length - 1} others are writing…`;
}

/** The word after an @ being typed at the end of the draft, or null. An @ inside a word (an email address) is not one. */
export const mentionQuery = (draft: string) => /(?:^|\s)@(\w*)$/.exec(draft)?.[1] ?? null;
export const peopleMatching = (people: BenchPerson[], query: string) => people.filter((p) => p.userName.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
export const insertMention = (draft: string, name: string) => draft.replace(/@\w*$/, `@${name} `);

const isAdmin = (user: AuthUser) => user.roles.includes("Administrator");
export const canEdit = (user: AuthUser, m: BenchMessage) => m.userId === user.userId && m.messageType === "text";
export const canDelete = (user: AuthUser, m: BenchMessage) => m.userId === user.userId || isAdmin(user);
/** Whoever can reach a channel may pin in it; direct messages have no pins. */
export const canPin = (room: Room) => room.kind === "channel";
