import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import type { ConversationSummary } from "@culinaire/shared/schemas/conversation";
import { client } from "../runtime/appContext";
import { newUuid } from "../outbox/uuid";
import { createChatApi, type ChatApi } from "./chatApi";
import { chatFailure, createChatStore, type ChatFailure } from "./chatStore";

interface Ctx {
  api: ChatApi;
  /** Resolves once the conversation last opened has nothing being answered or saved. */
  settled: RefObject<() => Promise<void>>;
}
const ChatContext = createContext<Ctx | null>(null);

/** The chat module's API, shared by the list and the conversation screens. */
export function ChatProvider({ api, children }: { api?: ChatApi; children: ReactNode }) {
  const settled = useRef(() => Promise.resolve());
  const value = useMemo<Ctx>(() => ({ api: api ?? createChatApi(client), settled }), [api]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function useChat(): Ctx {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("chat screens must be inside ChatProvider");
  return ctx;
}

/** One conversation: a saved one (`conversationId`) or a new one. Leaving the screen stops an answer in flight. */
export function useConversation(conversationId: string | null) {
  const { api, settled } = useChat();
  const store = useMemo(() => createChatStore({ api, newId: newUuid }), [api, conversationId]);
  useEffect(() => {
    settled.current = store.settled;
    if (conversationId) void store.open(conversationId);
    return () => store.dispose();
  }, [store, conversationId, settled]);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, snap };
}

export interface ConversationList {
  phase: "loading" | "ready" | "error";
  items: ConversationSummary[];
  failure: ChatFailure | null;
}

/** The saved conversations, newest first, with delete. Read again whenever the list screen comes back into view. */
export function useConversations() {
  const { api, settled } = useChat();
  const [list, setList] = useState<ConversationList>({ phase: "loading", items: [], failure: null });
  const refresh = useCallback(async () => {
    // Leaving a conversation mid-answer saves what arrived: read the list after that, so it is in it.
    await settled.current();
    try {
      setList({ phase: "ready", items: await api.list(), failure: null });
    } catch (err) {
      // A failed refresh keeps what is on screen.
      setList((prev) => ({ ...prev, phase: prev.items.length ? "ready" : "error", failure: chatFailure(err) }));
    }
  }, [api, settled]);
  const remove = useCallback(
    async (id: string) => {
      setList((prev) => ({ ...prev, items: prev.items.filter((c) => c.conversationId !== id) }));
      try {
        await api.remove(id);
      } catch (err) {
        setList((prev) => ({ ...prev, failure: chatFailure(err) }));
      }
      await refresh();
    },
    [api, refresh],
  );
  return { list, refresh, remove };
}
