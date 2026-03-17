/**
 * @module BenchPage
 *
 * "The Bench" — community chat for culinary professionals.
 * Two tabs: "Everyone" (global) and "My Kitchen" (organisation).
 *
 * - Registered users: full chat (send, react, etc.)
 * - Guest users: read-only view of the Everyone channel with a prompt to register
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Users, Building2, LogIn, MessageCircle } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "../context/AuthContext.js";
import { BenchSocketProvider, useBenchSocket } from "../context/BenchSocketContext.js";
import { useBenchMessages } from "../hooks/useBenchMessages.js";
import { useBenchPresence } from "../hooks/useBenchPresence.js";
import { useBenchTyping } from "../hooks/useBenchTyping.js";
import { BenchMessageList } from "../components/bench/BenchMessageList.js";
import { BenchMessageInput } from "../components/bench/BenchMessageInput.js";
import { BenchPresenceBar } from "../components/bench/BenchPresenceBar.js";
import { BenchTypingIndicator } from "../components/bench/BenchTypingIndicator.js";
import { useBenchDm } from "../hooks/useBenchDm.js";
import { BenchDmThreadList } from "../components/bench/BenchDmThreadList.js";
import { BenchDmConversation } from "../components/bench/BenchDmConversation.js";
import { BenchNotificationToast, type BenchNotification } from "../components/bench/BenchNotificationToast.js";

const API = import.meta.env.VITE_API_URL ?? "";

type Tab = "everyone" | "my-kitchen" | "messages";

function BenchContent() {
  const { user, isGuest } = useAuth();
  const { socket, connected } = useBenchSocket();
  const [tab, setTab] = useState<Tab>("everyone");
  const [hasOrg, setHasOrg] = useState(false);
  const [orgChannelKey, setOrgChannelKey] = useState<string | null>(null);
  const [publicBanner, setPublicBanner] = useState("This is the public channel — open to all registered chefs. Keep it professional and supportive.");
  const [orgBanner, setOrgBanner] = useState("This is your organisation's private channel. Only members of your team can see these messages.");

  const channelKey = tab === "everyone" ? "everyone" : orgChannelKey ?? "everyone";

  // Fetch banner text from site settings
  useEffect(() => {
    async function loadBanners() {
      try {
        const res = await fetch(`${API}/api/settings`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const s = data.settings ?? data;
        if (s.bench_public_banner) setPublicBanner(s.bench_public_banner);
        if (s.bench_org_banner) setOrgBanner(s.bench_org_banner);
      } catch {
        // Use defaults
      }
    }
    loadBanners();
  }, []);

  const { messages, loading, hasMore, loadMore, sendMessage, deleteMessage, editMessage } = useBenchMessages(channelKey);
  const { onlineUsers } = useBenchPresence(channelKey);
  const { typingUsers, emitTyping } = useBenchTyping(channelKey);
  const dm = useBenchDm();
  const [notifications, setNotifications] = useState<BenchNotification[]>([]);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // DM notification toast — show when DM arrives and not on Messages tab
  useEffect(() => {
    if (!socket) return;
    function onDmNotify(msg: { userId: number; userName: string; userPhotoPath: string | null; messageBody: string; dmThreadId: number }) {
      // Don't notify if already viewing Messages tab
      if (tabRef.current === "messages") return;
      // Don't notify for own messages
      if (msg.userId === user?.userId) return;
      setNotifications((prev) => [
        ...prev,
        {
          id: `dm-${Date.now()}`,
          userName: msg.userName,
          userPhotoPath: msg.userPhotoPath,
          message: msg.messageBody,
          type: "dm" as const,
          onClick: () => {
            dm.openThread(msg.dmThreadId);
            setTab("messages");
          },
        },
      ]);
    }
    socket.on("bench:dm:new", onDmNotify);
    return () => { socket.off("bench:dm:new", onDmNotify); };
  }, [socket, user?.userId, dm]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Check if user has an organisation
  useEffect(() => {
    if (!user || isGuest) return;
    async function checkOrg() {
      try {
        const res = await fetch(`${API}/api/bench/channels`, { credentials: "include" });
        if (!res.ok) return;
        const channels = await res.json();
        const orgCh = channels.find((c: any) => c.channelType === "organisation");
        if (orgCh) {
          setHasOrg(true);
          setOrgChannelKey(orgCh.channelKey);
          if (orgCh.channelBanner) setOrgBanner(orgCh.channelBanner);
        } else {
          // Try to create org channel
          const orgRes = await fetch(`${API}/api/organisations/mine`, { credentials: "include" });
          if (orgRes.ok) {
            const org = await orgRes.json();
            if (org?.organisationId) {
              const createRes = await fetch(`${API}/api/bench/channels/org`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ organisationName: org.organisationName }),
              });
              if (createRes.ok) {
                const ch = await createRes.json();
                setHasOrg(true);
                setOrgChannelKey(ch.channelKey);
                // Use org-specific banner if set
                if (ch.channelBanner) setOrgBanner(ch.channelBanner);
              }
            }
          }
        }
      } catch {
        // silent
      }
    }
    checkOrg();
  }, [user, isGuest]);

  function handleReaction(messageId: string, emoji: string) {
    const { socket } = useBenchSocket as any;
    // Reactions are handled via the socket in useBenchMessages
    // For now, emit directly
  }

  const isReadOnly = !user || isGuest;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* DM notification toasts */}
      <BenchNotificationToast notifications={notifications} onDismiss={dismissNotification} />

      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-stone-800">The Bench</h1>
            <p className="text-xs text-stone-500">Where the kitchen talks</p>
          </div>
          {!isReadOnly && (
            <div className="flex items-center gap-1">
              <span className={`size-2 rounded-full ${connected ? "bg-green-500" : "bg-stone-300"}`} />
              <span className="text-xs text-stone-400">
                {connected ? "Connected" : "Connecting..."}
              </span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          <button
            onClick={() => setTab("everyone")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === "everyone"
                ? "bg-amber-100 text-amber-800"
                : "text-stone-500 hover:bg-stone-100"
            }`}
          >
            <Users className="size-4" />
            Everyone
          </button>
          {hasOrg && (
            <button
              onClick={() => setTab("my-kitchen")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === "my-kitchen"
                  ? "bg-amber-100 text-amber-800"
                  : "text-stone-500 hover:bg-stone-100"
              }`}
            >
              <Building2 className="size-4" />
              My Kitchen
            </button>
          )}
          {!isReadOnly && (
            <button
              onClick={() => setTab("messages")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === "messages"
                  ? "bg-amber-100 text-amber-800"
                  : "text-stone-500 hover:bg-stone-100"
              }`}
            >
              <MessageCircle className="size-4" />
              Messages
            </button>
          )}
        </div>
      </div>

      {/* Messages tab — DM view */}
      {tab === "messages" ? (
        dm.activeThreadId && dm.activeThread ? (
          <BenchDmConversation
            thread={dm.activeThread}
            messages={dm.messages}
            loading={dm.loadingMessages}
            onSend={dm.sendDm}
            onBack={dm.closeThread}
          />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <BenchDmThreadList
              threads={dm.threads}
              loading={dm.loadingThreads}
              onSelect={dm.openThread}
            />
          </div>
        )
      ) : (
      <>
      {/* Presence bar */}
      {!isReadOnly && (
        <BenchPresenceBar
          users={onlineUsers}
          onStartDm={(uid) => { dm.startDm(uid); setTab("messages"); }}
        />
      )}

      {/* Message list */}
      <BenchMessageList
        messages={messages}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        onDelete={deleteMessage}
        onEdit={editMessage}
        onReaction={(messageId, emoji) => {
          if (socket?.connected) socket.emit("bench:reaction:add", { messageId, emoji });
        }}
        onRemoveReaction={(messageId, emoji) => {
          if (socket?.connected) socket.emit("bench:reaction:remove", { messageId, emoji });
        }}
        channelBanner={tab === "everyone" ? publicBanner : orgBanner}
        onStartDm={(userId) => {
          dm.startDm(userId);
          setTab("messages");
        }}
      />

      {/* Typing indicator */}
      {!isReadOnly && <BenchTypingIndicator typingUsers={typingUsers} />}

      {/* Input or registration prompt */}
      {isReadOnly ? (
        <div className="border-t border-stone-200 bg-stone-50 px-4 py-4 text-center">
          <p className="text-sm text-stone-500 mb-2">Sign in to join the conversation</p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
          >
            <LogIn className="size-4" />
            Sign In
          </Link>
        </div>
      ) : (
        <BenchMessageInput
          onSend={sendMessage}
          onTyping={emitTyping}
          disabled={!connected}
          placeholder={tab === "my-kitchen" ? "Message your kitchen team..." : "Message everyone... Use @ to mention someone"}
          onlineUsers={onlineUsers}
        />
      )}
      </>
      )}
    </div>
  );
}

export function BenchPage() {
  return (
    <BenchSocketProvider>
      <BenchContent />
    </BenchSocketProvider>
  );
}
