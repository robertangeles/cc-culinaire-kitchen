import { useCallback, useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { legalApi } from "../src/runtime/appContext";
import type { LegalPage, LegalSlug } from "../src/legal/legalApi";
import type { Span } from "../src/legal/markdown";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";
import { useColors } from "../src/ui/theme";
import { fontFamily, space } from "../src/theme";

const TITLES: Record<LegalSlug, string> = { terms: "Terms of Service", privacy: "Privacy Policy" };

function Spans({ spans }: { spans: Span[] }) {
  const c = useColors();
  return (
    <>
      {spans.map((s, i) => (
        <Text
          key={i}
          accessibilityRole={s.href ? "link" : undefined}
          onPress={s.href ? () => void Linking.openURL(s.href!).catch(() => undefined) : undefined}
          style={[s.bold && { fontFamily: fontFamily.title }, s.italic && { fontStyle: "italic" }, s.href && { color: c.accentText, textDecorationLine: "underline" }]}
        >
          {s.text}
        </Text>
      ))}
    </>
  );
}

/** Terms or privacy, from the server's published page, shown natively. Reachable signed out (from sign-in) and signed in (from Account). */
export default function Legal() {
  const router = useRouter();
  const c = useColors();
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const known = slug === "terms" || slug === "privacy" ? slug : null;
  const [page, setPage] = useState<LegalPage | "loading">("loading");

  const load = useCallback(() => {
    if (!known) return;
    setPage("loading");
    void legalApi.load(known).then(setPage);
  }, [known]);
  useEffect(load, [load]);

  const title = known ? (page !== "loading" && page.status === "ok" ? page.title : TITLES[known]) : "Not found";
  return (
    <Screen>
      <Text variant="title">{title}</Text>
      {page === "loading" && known ? <Text variant="muted">Loading…</Text> : null}
      {!known || (page !== "loading" && page.status === "unavailable") ? <Text variant="muted">This page isn't available in the app yet. Please check back soon.</Text> : null}
      {page !== "loading" && page.status === "offline" ? (
        <>
          <Text variant="muted">Can't reach the server. Try again.</Text>
          <Button kind="ghost" label="Try again" onPress={load} />
        </>
      ) : null}
      {page !== "loading" && page.status === "ok"
        ? page.blocks.map((b, i) => {
            if (b.type === "rule") return <View key={i} style={{ height: 1, backgroundColor: c.border }} />;
            if (b.type === "heading")
              return (
                <Text key={i} accessibilityRole="header" style={{ fontFamily: fontFamily.title, fontSize: b.level === 1 ? 26 : b.level === 2 ? 22 : 18 }}>
                  <Spans spans={b.spans} />
                </Text>
              );
            if (b.type === "list")
              return (
                <View key={i} style={{ gap: space.sm }}>
                  {b.items.map((item, n) => (
                    <View key={n} style={{ flexDirection: "row", gap: space.sm }}>
                      <Text>{b.ordered ? `${n + 1}.` : "•"}</Text>
                      <Text style={{ flex: 1 }}>
                        <Spans spans={item} />
                      </Text>
                    </View>
                  ))}
                </View>
              );
            return (
              <Text key={i}>
                <Spans spans={b.spans} />
              </Text>
            );
          })
        : null}
      <Button kind="quiet" label="Back" onPress={() => router.back()} />
    </Screen>
  );
}
