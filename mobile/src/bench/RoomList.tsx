import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useSession } from "../runtime/appContext";
import { hasAnyPermission } from "../shell/tabs";
import { timeAgo } from "../notifications/notificationView";
import { size, space } from "../theme";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Column } from "../ui/Column";
import { ScreenHeader } from "../ui/ScreenHeader";
import { Chip, Surface, rowDivider } from "../ui/Surface";
import { Text } from "../ui/Text";
import { useColors } from "../ui/theme";
import { sameRoom } from "./benchStore";
import type { Room } from "./benchApi";
import { useBench } from "./BenchProvider";

/** The channels, then the direct messages, newest first. `selected` is the room open beside the list on a tablet. */
export function RoomList({ selected, onOpen }: { selected: Room | null; onOpen: (room: Room) => void }) {
  const { store, snap, status } = useBench();
  const { state } = useSession();
  const router = useRouter();
  const c = useColors();
  const moderator = state.phase === "ready" && hasAnyPermission(state.user, ["bench:moderate"]);
  const [pulling, setPulling] = useState(false);

  const row = (room: Room, index: number, label: string, children: React.ReactNode) => {
    const open = selected !== null && sameRoom(selected, room);
    return (
      <Pressable
        key={JSON.stringify(room)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: open }}
        onPress={() => onOpen(room)}
        style={({ pressed }) => [{ minHeight: size.tap + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: open || pressed ? c.surface : undefined }, rowDivider(index, c.border)]}
      >
        {children}
      </Pressable>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.xl }}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={async () => { setPulling(true); await store.refreshLists(); setPulling(false); }} />}
    >
      <Column style={{ gap: space.lg }}>
        <ScreenHeader label="Where the kitchen talks" title="The Bench" />
        {status !== "online" && snap.lists === "ready" ? <Text variant="meta" accessibilityLiveRegion="polite">Connecting…</Text> : null}
        {snap.listError ? <Text variant="error">{snap.listError}</Text> : null}
        {snap.listError ? <Button kind="ghost" label="Try again" onPress={() => void store.refreshLists()} /> : null}
        {snap.lists === "loading" ? <Text variant="muted">Loading the Bench…</Text> : null}

        {snap.lists === "ready" ? (
          <>
            <View style={{ gap: space.xs }}>
              <Text variant="label">Channels</Text>
              <Surface>
                {snap.channels.map((ch, index) =>
                  row({ kind: "channel", key: ch.channelKey }, index, ch.channelName, (
                    <>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="heading" numberOfLines={2}>{ch.channelName}</Text>
                        <Text variant="meta">{ch.channelType === "global" ? "Every registered chef" : "My kitchen"}</Text>
                      </View>
                      <Text style={{ color: c.accentText, fontSize: 22 }}>›</Text>
                    </>
                  )),
                )}
              </Surface>
            </View>
            <View style={{ gap: space.xs }}>
              <Text variant="label">Direct messages</Text>
              <Surface>
                {snap.threads.length === 0 ? (
                  <View style={{ padding: space.lg, gap: space.xs }}>
                    <Text variant="heading">No direct messages yet</Text>
                    <Text variant="muted">Open your kitchen's channel and tap a colleague's message to write to them.</Text>
                  </View>
                ) : null}
                {snap.threads.map((t, index) => {
                  const fresh = snap.fresh.includes(t.dmThreadId);
                  return row({ kind: "dm", threadId: t.dmThreadId }, index, fresh ? `${t.otherUserName}, new message` : t.otherUserName, (
                    <>
                      <Avatar photoPath={t.otherUserPhotoPath} name={t.otherUserName} size={44} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                          <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>{t.otherUserName}</Text>
                          {fresh ? <Chip label="New" /> : t.lastMessageAt ? <Text variant="meta">{timeAgo(t.lastMessageAt, Date.now())}</Text> : null}
                        </View>
                        <Text variant="muted" numberOfLines={1}>{t.lastMessage ?? "No messages yet"}</Text>
                      </View>
                    </>
                  ));
                })}
              </Surface>
            </View>
            <Surface>
              {[["Blocked people", "/bench-blocked"], ...(moderator ? [["Reports to review", "/bench-reports"]] : [])].map(([label, pathname], index) => (
                <Pressable
                  key={pathname}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={() => router.push(pathname)}
                  style={({ pressed }) => [{ minHeight: size.tap + 8, flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, backgroundColor: pressed ? c.surface : undefined }, rowDivider(index, c.border)]}
                >
                  <Text variant="heading" style={{ flex: 1 }}>{label}</Text>
                  <Text style={{ color: c.accentText, fontSize: 22 }}>›</Text>
                </Pressable>
              ))}
            </Surface>
          </>
        ) : null}
      </Column>
    </ScrollView>
  );
}
