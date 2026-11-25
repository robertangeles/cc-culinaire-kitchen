import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyCard } from "../orders/ListState";
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
}

/**
 * The frame of every screen that lists what the server holds and the phone does not keep (roster, documents): pull to refresh, loading,
 * what went wrong with Try again, and the card for a module this kitchen has not switched on.
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
              <OfflineBanner text={snap.phase === "ready" ? `${snap.error} What you see may be out of date.` : snap.error} />
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
