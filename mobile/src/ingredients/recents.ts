import type { KvStore } from "../storage/kv";

/** The last few things the person picked, newest first, one per name (case aside), kept on the phone so they are there with no signal. */
export function createRecents<T extends { name: string }>({ kv, key, max }: { kv: KvStore; key: string; max: number }) {
  async function list(): Promise<T[]> {
    try {
      const parsed = JSON.parse((await kv.get(key)) ?? "[]") as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return {
    list,
    async remember(item: T): Promise<void> {
      const rest = (await list()).filter((r) => r.name.toLowerCase() !== item.name.toLowerCase());
      await kv.set(key, JSON.stringify([item, ...rest].slice(0, max)));
    },
  };
}

export type Recents<T extends { name: string }> = ReturnType<typeof createRecents<T>>;
