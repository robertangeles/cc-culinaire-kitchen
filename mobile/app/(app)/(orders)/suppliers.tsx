import { useCallback, useState } from "react";
import { Linking, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { ListState } from "../../../src/orders/ListState";
import { useList, useOrders } from "../../../src/orders/OrdersProvider";
import { dialable, supplierFacts } from "../../../src/orders/orderView";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { ScreenHeader } from "../../../src/ui/ScreenHeader";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** More suppliers than this and the list gets a search, as the web's has. */
const SEARCH_FROM = 6;

/** The organisation's suppliers, with their contacts and terms; a number opens the dialler. Kept on the phone, so a supplier can be called with no signal. */
export default function Suppliers() {
  const { state } = useSession();
  const { suppliers, rights } = useOrders();
  const snap = useList(suppliers);
  const router = useRouter();
  const c = useColors();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [callFailed, setCallFailed] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (rights.suppliers) void suppliers.refresh();
    }, [suppliers, rights.suppliers]),
  );
  if (state.phase !== "ready") return null;

  const q = query.trim().toLowerCase();
  const shown = [...snap.items].sort((a, b) => a.supplierName.localeCompare(b.supplierName)).filter((s) => !q || s.supplierName.toLowerCase().includes(q));
  const call = (name: string, number: string, written: string) =>
    void Linking.openURL(`tel:${number}`).then(
      () => setCallFailed(null),
      () => setCallFailed(`This phone can't make calls. ${name}'s number is ${written}.`),
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        contentContainerStyle={{ padding: space.xl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await suppliers.refresh(); setRefreshing(false); }} />}
      >
        <Column style={{ gap: space.lg }}>
          <ScreenHeader label={state.location.locationName} title="Suppliers" />
          {rights.suppliers ? (
            <>
              {snap.items.length > SEARCH_FROM ? <TextField label="Find a supplier" value={query} onChangeText={setQuery} placeholder="Search suppliers" autoCorrect={false} /> : null}
              {callFailed ? <Text variant="error" accessibilityLiveRegion="polite">{callFailed}</Text> : null}
              <ListState list={suppliers} snap={snap} loading="Loading suppliers…" empty={{ title: "No suppliers yet", text: "Suppliers are added on the web, under Purchasing." }}>
                {shown.length === 0 ? (
                  <Text variant="muted">No supplier matches.</Text>
                ) : (
                  <Surface>
                    {shown.map((s, i) => {
                      const number = dialable(s.contactPhone);
                      return (
                        <View key={s.supplierId} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: space.xs }, rowDivider(i, c.border)]}>
                          <Text variant="heading">{s.supplierName}</Text>
                          {s.contactName ? <Text>{s.contactName}</Text> : null}
                          {s.contactEmail ? <Text variant="meta" selectable>{s.contactEmail}</Text> : null}
                          {supplierFacts(s).length > 0 ? <Text variant="meta">{supplierFacts(s).join(" · ")}</Text> : null}
                          {s.notes ? <Text variant="muted">{s.notes}</Text> : null}
                          {number ? <Button kind="ghost" label={`Call ${s.supplierName}, ${s.contactPhone}`} onPress={() => call(s.supplierName, number, s.contactPhone!)} /> : <Text variant="meta">No phone number</Text>}
                        </View>
                      );
                    })}
                  </Surface>
                )}
              </ListState>
            </>
          ) : (
            <Text variant="muted">You don&apos;t have permission to see suppliers.</Text>
          )}
          <Button kind="quiet" label="Back to orders" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}
