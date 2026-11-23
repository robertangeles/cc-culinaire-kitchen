import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { legalApi } from "../src/runtime/appContext";
import type { LegalPage, LegalSlug } from "../src/legal/legalApi";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";
import { MarkdownBlocks } from "../src/ui/Markdown";

const TITLES: Record<LegalSlug, string> = { terms: "Terms of Service", privacy: "Privacy Policy" };

/** Terms or privacy, from the server's published page, shown natively. Reachable signed out (from sign-in) and signed in (from Account). */
export default function Legal() {
  const router = useRouter();
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
      {page !== "loading" && page.status === "ok" ? <MarkdownBlocks blocks={page.blocks} /> : null}
      <Button kind="quiet" label="Back" onPress={() => router.back()} />
    </Screen>
  );
}
