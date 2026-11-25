import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSession } from "../../../src/runtime/appContext";
import { useDocuments } from "../../../src/compliance/DocumentsProvider";
import { documentSections, expiryLine, statusLabel } from "../../../src/compliance/documentView";
import { EmptyCard } from "../../../src/orders/ListState";
import { venueToday } from "../../../src/roster/shiftView";
import { Button } from "../../../src/ui/Button";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { SectionLabel } from "../../../src/ui/SectionLabel";
import { ServerPage } from "../../../src/ui/ServerPage";
import { Chip, Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** My certificates: what needs me first, then what is with my manager, then the rest. */
export default function Documents() {
  const { state } = useSession();
  const { store, snap } = useDocuments();
  const router = useRouter();
  const c = useColors();
  useFocusEffect(useCallback(() => void store.refresh(), [store]));
  if (state.phase !== "ready") return null;

  const today = venueToday(state.location.ianaTimezone, Date.now());
  const sections = documentSections(snap.docs, today);

  return (
    <ServerPage
      header={<ScreenHeader label={state.location.locationName} title="My documents" />}
      snap={snap}
      loading="Loading your documents…"
      off={{ title: "Documents aren't in use here", text: "Your kitchen hasn't switched compliance documents on. Ask your manager." }}
      refresh={store.refresh}
    >
      {snap.phase === "ready" ? <Button label="Add a certificate" onPress={() => router.push("/document-new")} /> : null}
      {snap.phase === "ready" && sections.length === 0 ? <EmptyCard title="Add your first certificate" text="Take a photo of it. It takes about a minute, then your manager checks it." /> : null}
      {sections.map((section) => (
        <View key={section.title} style={{ gap: space.sm }}>
          <SectionLabel>{section.title}</SectionLabel>
          <Surface>
            {section.docs.map((d, i) => {
              const status = statusLabel(d, today);
              return (
                <Pressable
                  key={d.complianceDocumentId}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.documentType}, ${status}, ${expiryLine(d, today)}`}
                  onPress={() => router.push({ pathname: "/document", params: { id: d.complianceDocumentId } })}
                  style={({ pressed }) => [{ padding: space.lg, gap: space.xs, backgroundColor: pressed ? c.surface : undefined }, rowDivider(i, c.border)]}
                >
                  <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
                    <Text variant="heading" style={{ flexShrink: 1 }}>{d.documentType}</Text>
                    <Chip label={status} />
                  </View>
                  <Text variant="meta">{expiryLine(d, today)}</Text>
                  {d.verificationStatus === "Rejected" && d.rejectionReason ? <Text variant="muted">What to fix: {d.rejectionReason}</Text> : null}
                </Pressable>
              );
            })}
          </Surface>
        </View>
      ))}
    </ServerPage>
  );
}
