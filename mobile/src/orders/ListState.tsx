import { View } from "react-native";
import type { ReactNode } from "react";
import { space } from "../theme";
import { OfflineBanner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { Surface } from "../ui/Surface";
import { Text } from "../ui/Text";
import type { CachedList, ListSnapshot } from "./cachedList";

export const savedAtLabel = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** An empty list: one heading, one sentence, in a card. */
export function EmptyCard({ title, text }: { title: string; text: string }) {
  return (
    <Surface>
      <View style={{ padding: space.lg, gap: space.xs }}>
        <Text variant="heading">{title}</Text>
        <Text variant="muted">{text}</Text>
      </View>
    </Surface>
  );
}

/** Everything around a list's rows: loading, what went wrong with Try again, the saved copy's banner, the empty card and Show more. */
export function ListState<T>({ list, snap, loading, empty, children }: { list: CachedList<T>; snap: ListSnapshot<T>; loading: string; empty: { title: string; text: string }; children: ReactNode }) {
  return (
    <>
      {snap.savedAt ? <OfflineBanner text={`Can't reach the server. This is the list from ${savedAtLabel(snap.savedAt)}. Changes need a connection.`} /> : snap.error ? <OfflineBanner text={snap.error} /> : null}
      {snap.error ? <Button kind="ghost" label="Try again" onPress={() => void list.refresh()} /> : null}
      {snap.phase === "loading" ? <Text variant="muted">{loading}</Text> : null}
      {snap.phase === "ready" && snap.items.length === 0 ? <EmptyCard {...empty} /> : null}
      {snap.items.length > 0 ? children : null}
      {snap.hasMore ? <Button kind="quiet" label={snap.loadingMore ? "Loading…" : "Show more"} disabled={snap.loadingMore} onPress={() => void list.loadMore()} /> : null}
    </>
  );
}
