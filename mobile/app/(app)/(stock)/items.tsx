import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStock } from "../../../src/stock/StockProvider";
import { categoryLabel, findItems, qtyText } from "../../../src/stock/stockView";
import { OfflineBanner } from "../../../src/ui/Banner";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { TextField } from "../../../src/ui/TextField";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { fontFamily, size, space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** Look up an item in the catalogue: the items used here, or a search of the whole catalogue. Read from the phone, so it works with no signal. */
export default function Items() {
  const { snap } = useStock();
  const router = useRouter();
  const c = useColors();
  const [query, setQuery] = useState("");
  const found = findItems(snap.items, query);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl }} keyboardShouldPersistTaps="handled">
        <Column style={{ gap: space.lg }}>
          <Text variant="title">Look up an item</Text>
          {snap.offline ? <OfflineBanner text="You're offline. This is the catalogue as last downloaded." /> : null}
          <TextField label="Search the catalogue" value={query} onChangeText={setQuery} placeholder="Item name" autoCorrect={false} returnKeyType="search" />
          {found.length === 0 ? (
            <Text variant="muted">{query.trim() ? `Nothing in the catalogue matches "${query.trim()}".` : snap.items.length === 0 ? "The catalogue has not been downloaded to this phone yet." : "No items are in use at this location yet."}</Text>
          ) : (
            <Surface>
              {found.map((item, index) => (
                <Pressable
                  key={item.ingredientId}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.ingredientName}, ${categoryLabel(item.ingredientCategory)}, on hand ${qtyText(item.currentQty, item.baseUnit)}${item.activeInd ? "" : ", not used here"}`}
                  onPress={() => router.push({ pathname: "/item/[ingredientId]", params: { ingredientId: item.ingredientId } })}
                  style={[{ minHeight: size.tap, paddingVertical: space.md, paddingHorizontal: space.lg, gap: 2 }, rowDivider(index, c.border)]}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md }}>
                    <Text variant="heading" style={{ flexShrink: 1 }}>{item.ingredientName}</Text>
                    <Text style={{ fontFamily: fontFamily.uiStrong }}>{qtyText(item.currentQty, item.baseUnit)}</Text>
                  </View>
                  <Text variant="meta">{`${categoryLabel(item.ingredientCategory)}${item.activeInd ? "" : " · not used here"}`}</Text>
                </Pressable>
              ))}
            </Surface>
          )}
          <Button kind="quiet" label="Not in the catalogue? Ask for it" onPress={() => router.push({ pathname: "/request-new", params: { name: query.trim() } })} />
          <Button kind="quiet" label="Back" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}
