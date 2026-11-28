/**
 * @module BenchPage
 *
 * "The Bench" — community chat for culinary professionals.
 * Two tabs: "Everyone" (global) and "My Kitchen" (organisation).
 *
 * - Registered users: full chat (send, react, etc.)
 * - Guest users: read-only view of the Everyone channel with a prompt to register
 * - Anyone signed in can report a message or a person, and block a person
 *   (their messages leave the screen at once; "Blocked people" lists them)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Users, Building2, LogIn, MessageCircle, UserX, X } from "lucide-react";
import { Link } from "react-router";
import { BENCH_POST_REFUSED } from "@culinaire/shared";
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
import { useBenchBlocks, type BenchPerson, type ReportTarget } from "../hooks/useBenchSafety.js";
import { BenchReportDialog } from "../components/bench/BenchReportDialog.js";
import { BenchBlockedPanel } from "../components/bench/BenchBlockedPanel.js";

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

  const isReadOnly = !user || isGuest;
  const { messages, loading, hasMore, loadMore, sendMessage, deleteMessage, editMessage, reload: reloadMessages, refused, clearRefused } = useBenchMessages(channelKey);
  const { onlineUsers } = useBenchPresence(channelKey);
  const { typingUsers, emitTyping } = useBenchTyping(channelKey);
  const dm = useBenchDm();
  const [notifications, setNotifications] = useState<BenchNotification[]>([]);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const blocks = useBenchBlocks(!isReadOnly);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // A blocked person's messages, DM thread and avatar leave the screen at once
  const { blockedIds } = blocks;
  const shownMessages = messages.filter((m) => !blockedIds.has(m.userId));
  const shownThreads = dm.threads.filter((t) => !blockedIds.has(t.otherUserId));
  const shownOnline = onlineUsers.filter((u) => !blockedIds.has(u.userId));

  async function handleBlock(person: BenchPerson) {
    if (!window.confirm(`Block ${person.userName}? You won't see their messages, and neither of you can message the other. They aren't told.`)) return;
    const failed = await blocks.block(person);
    if (failed) return setNotice(failed.error);
    if (dm.activeThread?.otherUserId === person.userId) dm.closeThread();
  }

  async function handleUnblock(person: BenchPerson) {
    const failed = await blocks.unblock(person.userId);
    if (failed) return setNotice(failed.error);
    reloadMessages();
    dm.fetchThreads();
  }

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

  // A post or edit with a word the list does not allow: one sentence that never says which, the draft back in the composer
  useEffect(() => {
    if (!socket) return;
    function onError({ code }: { code?: string }) {
      if (code === "POST_NOT_ALLOWED") setNotice(BENCH_POST_REFUSED);
    }
    socket.on("bench:error", onError);
    return () => { socket.off("bench:error", onError); };
  }, [socket]);

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
        const channels = await res.json() as Array<{ channelKey: string; channelType?: string; channelBanner?: string }>;
        const orgCh = channels.find((c) => c.channelType === "organisation");
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-dark">
      {/* DM notification toasts */}
      <BenchNotificationToast notifications={notifications} onDismiss={dismissNotification} />

      {/* Header */}
      <div className="bg-dark-50 border-b border-dark-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[#FAFAFA]">The Bench</h1>
            <p className="text-xs text-dark-600">Where the kitchen talks</p>
          </div>
          {!isReadOnly && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowBlocked((v) => !v)}
                aria-expanded={showBlocked}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 ${
                  showBlocked ? "bg-gold/10 text-gold" : "text-dark-600 hover:bg-dark-100 hover:text-[#E5E5E5]"
                }`}
              >
                <UserX className="size-3.5" />
                Blocked people
              </button>
              <div className="flex items-center gap-1">
                <span className={`size-2 rounded-full ${connected ? "bg-emerald-400" : "bg-dark-500"}`} />
                <span className="text-xs text-dark-500">
                  {connected ? "Connected" : "Connecting..."}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          <button
            onClick={() => setTab("everyone")}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              tab === "everyone"
                ? "bg-gold text-dark"
                : "text-dark-600 hover:bg-dark-100 hover:text-[#E5E5E5]"
            }`}
          >
            <Users className="size-4" />
            Everyone
          </button>
          {hasOrg && (
            <button
              onClick={() => setTab("my-kitchen")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                tab === "my-kitchen"
                  ? "bg-gold text-dark"
                  : "text-dark-600 hover:bg-dark-100 hover:text-[#E5E5E5]"
              }`}
            >
              <Building2 className="size-4" />
              My Kitchen
            </button>
          )}
          {!isReadOnly && (
            <button
              onClick={() => setTab("messages")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                tab === "messages"
                  ? "bg-gold text-dark"
                  : "text-dark-600 hover:bg-dark-100 hover:text-[#E5E5E5]"
              }`}
            >
              <MessageCircle className="size-4" />
              Messages
            </button>
          )}
        </div>

        {showBlocked && !isReadOnly && <BenchBlockedPanel blocked={blocks.blocked} onUnblock={handleUnblock} />}
      </div>

      {notice && (
        <div role="alert" className="flex items-center gap-2 px-4 py-2 border-b border-red-500/20 bg-red-500/10 text-sm text-red-300">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="p-0.5 rounded hover:text-white">
            <X className="size-4" />
          </button>
        </div>
      )}

      {reportTarget && <BenchReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />}

      {/* Messages tab — DM view */}
      {tab === "messages" ? (
        <>
        {dm.error && (
          <p role="alert" className="px-4 py-2 border-b border-dark-200 bg-dark-50 text-sm text-red-300">{dm.error}</p>
        )}
        {dm.activeThreadId && dm.activeThread ? (
          <BenchDmConversation
            thread={dm.activeThread}
            messages={dm.messages}
            loading={dm.loadingMessages}
            onSend={(recipientId, body) => { setNotice(null); dm.sendDm(recipientId, body); }}
            onBack={dm.closeThread}
            onReport={setReportTarget}
            onBlock={handleBlock}
            returned={dm.refused}
            onReturned={dm.clearRefused}
          />
        ) : (
          <div className="flex-1 overflow-y-auto bg-dark">
            {dm.startError && (
              <p role="alert" className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                {dm.startError}
              </p>
            )}
            <BenchDmThreadList
              threads={shownThreads}
              loading={dm.loadingThreads}
              onSelect={dm.openThread}
            />
          </div>
        )}
        </>
      ) : (
      <>
      {/* Presence bar */}
      {!isReadOnly && (
        <BenchPresenceBar
          users={shownOnline}
          selfId={user?.userId}
          onStartDm={(uid) => { dm.startDm(uid); setTab("messages"); }}
          onReport={setReportTarget}
          onBlock={handleBlock}
        />
      )}

      {/* Message list */}
      <BenchMessageList
        messages={shownMessages}
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
        onReport={isReadOnly ? undefined : setReportTarget}
        onBlock={isReadOnly ? undefined : handleBlock}
      />

      {/* Typing indicator */}
      {!isReadOnly && <BenchTypingIndicator typingUsers={typingUsers} />}

      {/* Input or registration prompt */}
      {isReadOnly ? (
        <div className="border-t border-dark-200 bg-dark-50 px-4 py-4 text-center">
          <p className="text-sm text-dark-600 mb-2">Sign in to join the conversation</p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gold text-dark text-sm font-medium rounded-xl hover:bg-gold-hover transition-colors"
          >
            <LogIn className="size-4" />
            Sign In
          </Link>
        </div>
      ) : (
        <BenchMessageInput
          onSend={(body) => { setNotice(null); sendMessage(body); }}
          onTyping={emitTyping}
          disabled={!connected}
          placeholder={tab === "my-kitchen" ? "Message your kitchen team..." : "Message everyone... Use @ to mention someone"}
          onlineUsers={shownOnline}
          returned={refused}
          onReturned={clearRefused}
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
