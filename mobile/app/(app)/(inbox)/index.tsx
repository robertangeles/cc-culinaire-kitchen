import { useCallback } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { push, usePushStatus, useSession } from "../../../src/runtime/appContext";
import { inbox, useInbox } from "../../../src/runtime/notifications";
import { notificationText, routeFor, timeAgo } from "../../../src/notifications/notificationView";
import { Screen } from "../../../src/ui/Screen";
import { Text } from "../../../src/ui/Text";
import { SectionLabel } from "../../../src/ui/SectionLabel";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Button } from "../../../src/ui/Button";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** Unread notifications, newest first. Reading one takes it off the list (the server keeps no read history). */
export default function Inbox() {
  const { state } = useSession();
  const snap = useInbox();
  const status = usePushStatus();
  const router = useRouter();
  const c = useColors();
  useFocusEffect(useCallback(() => void inbox.refresh(), []));
  if (state.phase !== "ready") return null;

  return (
    <Screen align="top">
      <ScreenHeader label={state.location.locationName} title="Inbox" />
      {snap.offline && snap.phase === "ready" ? <OfflineBanner text="No signal. Showing what was here last time." /> : null}
      <PushCard status={status} />
      {snap.phase === "loading" ? <Text variant="muted">Loading…</Text> : null}
      {snap.phase === "failed" ? (
        <>
          <Text variant="error">Couldn't load your notifications. Check your signal and try again.</Text>
          <Button kind="ghost" label="Try again" onPress={() => void inbox.refresh()} />
        </>
      ) : null}
      {snap.phase === "ready" && snap.items.length === 0 ? (
        <Surface>
          <View style={{ padding: space.lg, gap: space.xs }}>
            <Text variant="heading">You're all caught up</Text>
            <Text variant="muted">New shifts, orders and documents that need you will show here.</Text>
          </View>
        </Surface>
      ) : null}
      {snap.items.length > 0 ? (
        <>
          <Text variant="meta">{snap.unread === 1 ? "1 unread" : `${snap.unread} unread`}</Text>
          <Surface>
            {snap.items.map((n, index) => {
              const { title, body } = notificationText(n);
              const route = routeFor(n, state.user);
              return (
                <View key={n.notificationId} accessible accessibilityLabel={`${title}. ${body}`} style={[{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs, gap: space.xs }, rowDivider(index, c.border)]}>
                  <SectionLabel>{title}</SectionLabel>
                  <Text>{body}</Text>
                  <Text variant="meta">{timeAgo(n.createdAt, Date.now())}</Text>
                  <View style={{ flexDirection: "row", gap: space.xl, flexWrap: "wrap" }}>
                    {route ? (
                      <Button
                        kind="quiet"
                        label="Open"
                        onPress={() => {
                          void inbox.markRead(n.notificationId);
                          router.navigate(route as never);
                        }}
                      />
                    ) : null}
                    <Button kind="quiet" label="Mark read" onPress={() => void inbox.markRead(n.notificationId)} />
                  </View>
                </View>
              );
            })}
          </Surface>
        </>
      ) : null}
      <Button kind="ghost" label="Notification settings" onPress={() => router.push("/notification-settings")} />
    </Screen>
  );
}

/** Push is asked for here, when the person has a reason to want it, never at launch. */
function PushCard({ status }: { status: string }) {
  if (status !== "off" && status !== "blocked") return null;
  return (
    <Surface>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Text style={{ fontFamily: fontFamily.title, fontSize: 20 }}>{status === "off" ? "Get a push when something needs you" : "Notifications are off in your phone's settings"}</Text>
        <Text variant="muted">
          {status === "off" ? "A new shift, an order to approve, a document checked. The lock screen never shows names or details." : "Turn them on for CulinAIre Kitchen in Settings to get a push."}
        </Text>
        <Button label={status === "off" ? "Turn on" : "Open settings"} onPress={() => void (status === "off" ? push.enable() : push.openSettings())} />
      </View>
    </Surface>
  );
}
