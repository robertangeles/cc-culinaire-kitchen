import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import type { BenchMessage, BenchPerson, BenchPin, BenchSearchHit } from "@culinaire/shared/schemas/bench";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import { fontFamily, radius, size, space } from "../theme";
import { Avatar } from "../ui/Avatar";
import { OfflineBanner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { Column } from "../ui/Column";
import { Surface, rowDivider } from "../ui/Surface";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { useColors } from "../ui/theme";
import { useRoom } from "./BenchProvider";
import type { Room } from "./benchApi";
import { benchFailure, type PendingPost } from "./benchStore";
import { canPin, dayLabel, DEFAULT_BANNER, timeOf, typingText } from "./benchView";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";

type Row = { key: string } & ({ type: "day"; label: string } | { type: "message"; message: BenchMessage } | { type: "pending"; post: PendingPost });
type Panel = "people" | "pins" | "search" | null;

/**
 * One room: its messages, newest at the bottom, and where to write. `onBack` on a phone; on a tablet the list is beside it.
 * The screen lifts it above the keyboard, with a KeyboardAvoidingView directly inside its SafeAreaView: nested deeper, it would not count the top inset.
 */
export function RoomView({ room, user, onBack, onOpen }: { room: Room; user: AuthUser; onBack?: () => void; onOpen: (room: Room) => void }) {
  const { api, store, snap, status } = useRoom(room);
  const c = useColors();
  const [openId, setOpenId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [pins, setPins] = useState<BenchPin[] | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const state = snap.room;
  const channel = room.kind === "channel" ? snap.channels.find((x) => x.channelKey === room.key) : undefined;
  const thread = room.kind === "dm" ? snap.threads.find((t) => t.dmThreadId === room.threadId) : undefined;
  const kitchen = channel?.channelType === "organisation";
  const title = channel?.channelName ?? thread?.otherUserName ?? "The Bench";
  // Who was there before the connection went says nothing about now.
  const here: BenchPerson[] = kitchen && room.kind === "channel" && status === "online" ? (snap.presence[room.key] ?? []) : [];
  const mayPin = canPin(user, room);

  // Where pins can be changed, which messages are pinned is known from the start, for Pin or Unpin.
  async function loadPins() {
    if (room.kind !== "channel") return;
    try {
      setPins(await api.pins(room.key));
      setPinError(null);
    } catch (err) {
      setPinError(benchFailure(err));
    }
  }
  useEffect(() => {
    if (mayPin) void loadPins();
  }, [mayPin, JSON.stringify(room)]);

  async function togglePin(messageId: string, pinned: boolean) {
    if (room.kind !== "channel") return;
    try {
      await (pinned ? api.unpin(messageId) : api.pin(room.key, messageId));
    } catch (err) {
      // In a kitchen a refusal means its member is one no more; in Everyone, someone no longer an administrator.
      setPinError(err instanceof ApiError && err.code === "forbidden" && room.key === "everyone" ? "Only administrators can pin in Everyone." : benchFailure(err));
      return;
    }
    await loadPins();
    setOpenId(null);
  }

  const write = async (userId: number) => {
    const threadId = await store.startThread(userId);
    if (threadId !== null) onOpen({ kind: "dm", threadId });
  };

  // Newest first: the list is drawn from the bottom up, so older pages load above without moving what is on screen.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let day = "";
    for (const message of state?.messages ?? []) {
      const label = dayLabel(message.createdDttm, Date.now());
      if (label !== day) out.push({ key: `day-${message.messageId}`, type: "day", label });
      day = label;
      out.push({ key: message.messageId, type: "message", message });
    }
    for (const post of state?.pending ?? []) out.push({ key: post.id, type: "pending", post });
    return out.reverse();
  }, [state?.messages, state?.pending]);

  /** People of this room for an @: who is in it, and who wrote what is on screen. */
  const people = useMemo(() => {
    const all = new Map<number, BenchPerson>();
    for (const p of here) all.set(p.userId, p);
    for (const m of state?.messages ?? []) all.set(m.userId, { userId: m.userId, userName: m.userName, userPhotoPath: m.userPhotoPath });
    all.delete(user.userId);
    return [...all.values()].sort((a, b) => a.userName.localeCompare(b.userName));
  }, [here, state?.messages, user.userId]);

  const togglePanel = (next: Panel) => {
    setPanel(panel === next ? null : next);
    if (next === "pins") void loadPins();
  };
  const tool = (label: string, to: Panel) => (
    <Pressable key={label} accessibilityRole="button" accessibilityState={{ expanded: panel === to }} onPress={() => togglePanel(to)} style={{ minHeight: size.tap, justifyContent: "center" }}>
      <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>{label}</Text>
    </Pressable>
  );

  const banner = channel ? (channel.channelBanner ?? DEFAULT_BANNER[channel.channelType]) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <Column>
          {onBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back to the Bench" hitSlop={8} onPress={onBack} style={{ minHeight: size.tap, justifyContent: "center", alignSelf: "flex-start" }}>
              <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>‹ The Bench</Text>
            </Pressable>
          ) : null}
          <View style={{ gap: space.xs, paddingTop: onBack ? 0 : space.lg }}>
            <Text variant="label">{room.kind === "dm" ? "Direct message" : kitchen ? "My kitchen" : "Every registered chef"}</Text>
            <Text variant="title" numberOfLines={2} style={{ fontSize: 26 }}>{title}</Text>
          </View>
          {room.kind === "channel" ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.xl }}>
              {kitchen ? tool(here.length === 0 ? "On the pass" : `${here.length} on the pass`, "people") : null}
              {tool("Pinned", "pins")}
              {tool("Search", "search")}
            </View>
          ) : (
            <View style={{ height: space.md }} />
          )}
        </Column>
      </View>

      {panel ? (
        // Scrolls by itself: a long list must not push the messages and the composer off the screen. A search takes the room it needs: the composer steps aside.
        <ScrollView style={{ flexGrow: 0, flexShrink: 1, maxHeight: panel === "search" ? "100%" : "50%", borderBottomWidth: 1, borderBottomColor: c.border }} contentContainerStyle={{ paddingHorizontal: space.xl, paddingVertical: space.md }} keyboardShouldPersistTaps="handled">
          <Column style={{ gap: space.sm }}>
            {panel === "people" ? <People people={here} me={user.userId} canWrite={store.canMessage} onWrite={(id) => void write(id)} /> : null}
            {panel === "pins" ? <Pins pins={pins} error={pinError} onUnpin={mayPin ? (id) => void togglePin(id, true) : undefined} /> : null}
            {panel === "search" && room.kind === "channel" ? <Search find={(q) => api.search(room.key, q)} /> : null}
          </Column>
        </ScrollView>
      ) : null}

      <FlatList
        inverted
        style={{ flex: 1 }}
        data={state?.phase === "ready" ? rows : []}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingVertical: space.md }}
        // Drawn upside down: the "footer" is the top of the room.
        ListFooterComponent={
          <Column style={{ gap: space.md, paddingBottom: space.md }}>
            {banner ? (
              <View style={{ borderRadius: radius.banner, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, padding: space.lg }}>
                <Text variant="muted">{banner}</Text>
              </View>
            ) : null}
            {!state || state.phase === "loading" ? <Text variant="muted">Loading the messages…</Text> : null}
            {state?.phase === "error" ? (
              <>
                <Text variant="error">{state.error}</Text>
                <Button kind="ghost" label="Try again" onPress={() => void store.open(room)} />
              </>
            ) : null}
            {state?.phase === "ready" && rows.length === 0 ? (
              <Surface>
                <View style={{ padding: space.lg, gap: space.xs }}>
                  <Text variant="heading">Start the conversation</Text>
                  <Text variant="muted">{room.kind === "dm" ? `Write to ${title}.` : "Be the first to share something with the team."}</Text>
                </View>
              </Surface>
            ) : null}
            {state?.phase === "ready" && state.hasOlder ? <Button kind="quiet" label={state.loadingOlder ? "Loading…" : "Load older messages"} disabled={state.loadingOlder} onPress={() => void store.loadOlder()} /> : null}
          </Column>
        }
        renderItem={({ item }) => (
          <Column>
            {item.type === "day" ? (
              <Text variant="label" style={{ textAlign: "center", paddingVertical: space.md }}>{item.label}</Text>
            ) : item.type === "pending" ? (
              <PendingRow post={item.post} connected={status === "online"} onRetry={() => void store.retry(item.post.id)} onDiscard={() => store.discard(item.post.id)} />
            ) : (
              <MessageRow
                message={item.message}
                user={user}
                reactions={room.kind === "channel"}
                open={openId === item.message.messageId}
                onToggle={() => setOpenId(openId === item.message.messageId ? null : item.message.messageId)}
                actions={{
                  react: (emoji) => store.react(item.message.messageId, emoji),
                  edit: (text) => store.edit(item.message.messageId, text),
                  remove: () => store.remove(item.message.messageId),
                  pinned: pins?.some((p) => p.messageId === item.message.messageId) ?? false,
                  pin: mayPin ? () => void togglePin(item.message.messageId, pins?.some((p) => p.messageId === item.message.messageId) ?? false) : undefined,
                  write: room.kind === "channel" && store.canMessage(item.message.userId) ? () => void write(item.message.userId) : undefined,
                }}
              />
            )}
          </Column>
        )}
      />

      {state?.phase === "ready" ? (
        // Hidden, not gone, while searching: what was being written is still there after.
        <View style={{ display: panel === "search" ? "none" : "flex" }}>
          <View style={{ paddingHorizontal: space.xl }}>
            <Column style={{ gap: space.sm }}>
              {status !== "online" ? <OfflineBanner text="Not connected. New messages show when you're back online, and nothing you write is sent until then." /> : null}
              {state.notice ? <Text variant="error" accessibilityLiveRegion="polite">{state.notice}</Text> : null}
              {pinError && panel !== "pins" ? <Text variant="error" accessibilityLiveRegion="polite">{pinError}</Text> : null}
              <Text variant="meta" accessibilityLiveRegion="polite" style={{ minHeight: 24 }}>{typingText(state.typing.map((t) => t.userName))}</Text>
            </Column>
          </View>
          <Composer
            key={JSON.stringify(room)}
            placeholder={room.kind === "dm" ? `Message ${title}` : kitchen ? "Message your kitchen team" : "Message everyone"}
            people={room.kind === "dm" ? [] : people}
            onTyping={store.typing}
            onPost={store.post}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A post the server has not been seen to have: on its way, or not sent, with the choice. */
function PendingRow({ post, connected, onRetry, onDiscard }: { post: PendingPost; connected: boolean; onRetry: () => void; onDiscard: () => void }) {
  const c = useColors();
  return (
    <View style={{ alignSelf: "flex-end", maxWidth: "88%", gap: space.xs, paddingVertical: space.sm }}>
      <View style={{ backgroundColor: c.field, borderRadius: radius.key, padding: space.lg, opacity: post.status === "sending" ? 0.7 : 1 }}>
        <Text>{post.body}</Text>
      </View>
      {post.status === "sending" ? (
        <Text variant="meta" style={{ textAlign: "right" }}>{connected ? "Sending…" : "Not confirmed yet"}</Text>
      ) : (
        <View style={{ alignItems: "flex-end" }}>
          <Text variant="error">Not sent.</Text>
          <View style={{ flexDirection: "row", gap: space.xl }}>
            <Button kind="quiet" label="Try again" disabled={!connected} onPress={onRetry} />
            <Button kind="quiet" label="Discard" onPress={onDiscard} />
          </View>
        </View>
      )}
    </View>
  );
}

function People({ people, me, canWrite, onWrite }: { people: BenchPerson[]; me: number; canWrite: (id: number) => boolean; onWrite: (id: number) => void }) {
  const c = useColors();
  return (
    <Surface>
      {people.length === 0 ? (
        <View style={{ padding: space.lg }}>
          <Text variant="muted">Not known while there is no connection.</Text>
        </View>
      ) : null}
      {people.map((p, i) => (
        <View key={p.userId} style={[{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg }, rowDivider(i, c.border)]}>
          <Avatar photoPath={p.userPhotoPath} name={p.userName} size={32} />
          <Text style={{ flex: 1, fontFamily: fontFamily.uiStrong }}>{p.userId === me ? `${p.userName} (you)` : p.userName}</Text>
          {canWrite(p.userId) ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Message ${p.userName}`} onPress={() => onWrite(p.userId)} style={{ minHeight: size.tap, justifyContent: "center" }}>
              <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>Message</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </Surface>
  );
}

function Pins({ pins, error, onUnpin }: { pins: BenchPin[] | null; error: string | null; onUnpin?: (messageId: string) => void }) {
  const c = useColors();
  if (error) return <Text variant="error">{error}</Text>;
  if (pins === null) return <Text variant="muted">Loading the pinned messages…</Text>;
  return (
    <Surface>
      {pins.length === 0 ? (
        <View style={{ padding: space.lg }}>
          <Text variant="muted">Nothing is pinned here.</Text>
        </View>
      ) : null}
      {pins.map((p, i) => (
        <View key={p.messageId} style={[{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md }, rowDivider(i, c.border)]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: fontFamily.uiStrong }}>{p.userName}</Text>
            <Text numberOfLines={3}>{p.messageBody}</Text>
          </View>
          {onUnpin ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Unpin ${p.userName}'s message`} onPress={() => onUnpin(p.messageId)} style={{ minHeight: size.tap, justifyContent: "center" }}>
              <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>Unpin</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </Surface>
  );
}

/** Looks through the whole channel on the server once typing pauses. */
function Search({ find }: { find: (q: string) => Promise<BenchSearchHit[]> }) {
  const c = useColors();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<BenchSearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFound(null);
    setError(null);
    if (!q.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      find(q).then((hits) => current && setFound(hits), (err) => current && setError(benchFailure(err)));
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q]);
  return (
    <>
      <TextField label="Search this channel" value={q} onChangeText={setQ} placeholder="A word or a name" autoCorrect={false} maxLength={200} />
      {error ? <Text variant="error">{error}</Text> : null}
      {found?.length === 0 ? <Text variant="muted">No messages match.</Text> : null}
      {found && found.length > 0 ? (
        <Surface>
          {found.slice(0, 5).map((h, i) => (
            <View key={h.messageId} style={[{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 }, rowDivider(i, c.border)]}>
              <Text variant="meta">{`${h.userName} · ${h.createdDttm ? `${dayLabel(h.createdDttm, Date.now())}, ${timeOf(h.createdDttm)}` : ""}`}</Text>
              <Text numberOfLines={2}>{h.messageBody}</Text>
            </View>
          ))}
        </Surface>
      ) : null}
      {found && found.length > 5 ? <Text variant="meta">{`The newest 5 of ${found.length}${found.length >= 50 ? "+" : ""}. Add a word to narrow it.`}</Text> : null}
    </>
  );
}
