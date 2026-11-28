import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { timeAgo } from "../notifications/notificationView";
import { EmptyCard, savedAtLabel } from "../orders/ListState";
import { OfflineBanner } from "./Banner";
import { Button } from "./Button";
import { Column } from "./Column";
import { Text } from "./Text";
import { space } from "../theme";
import { useColors } from "./theme";

interface State {
  phase: "loading" | "ready" | "failed";
  off: boolean;
  error: string | null;
  /** Set when what is shown is the phone's saved copy. */
  savedAt: string | null;
}

/** Why it is not fresh, and how old what is shown is. */
function staleText(error: string, { phase, savedAt }: State): string {
  if (savedAt) return `${error} Saved on this phone ${timeAgo(savedAt, Date.now()).toLowerCase()} (${savedAtLabel(savedAt)}). Changes need a connection.`;
  return phase === "ready" ? `${error} What you see may be out of date.` : error;
}

/**
 * The frame of every screen that lists what the server holds, with the phone's sealed copy for no signal (roster, documents): pull to refresh,
 * loading, what went wrong with Try again, how old a saved copy is, and the card for a module this kitchen has not switched on.
 */
export function ServerPage({ header, snap, loading, off, refresh, children }: { header: ReactNode; snap: State; loading: string; off: { title: string; text: string }; refresh: () => Promise<unknown>; children: ReactNode }) {
  const c = useColors();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          {header}
          {snap.error ? (
            <>
              <OfflineBanner text={staleText(snap.error, snap)} />
              <Button kind="ghost" label="Try again" onPress={() => void refresh()} />
            </>
          ) : null}
          {snap.phase === "loading" ? <Text variant="muted">{loading}</Text> : null}
          {snap.off ? <EmptyCard {...off} /> : children}
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}
