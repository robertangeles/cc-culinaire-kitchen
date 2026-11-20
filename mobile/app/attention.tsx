import { Alert, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { session } from "../src/app/appContext";
import { outbox, runner } from "../src/app/appOutbox";
import { useCount } from "../src/app/countContext";
import { attentionCopy, describeCount } from "../src/count/attentionCopy";
import { Button } from "../src/ui/Button";
import { Text } from "../src/ui/Text";
import { space } from "../src/theme";
import { useColors } from "../src/ui/theme";

/** Counts the server didn't take. Each keeps the number the chef typed and offers only what can work. */
export default function Attention() {
  const { snap } = useCount();
  const router = useRouter();
  const c = useColors();
  const stuck = Object.values(snap.entries).flat().filter((e) => e.status === "NEEDS_ATTENTION");

  function discard(id: string, label: string) {
    Alert.alert(`Discard ${label}?`, "This count won't be sent. A record of it is kept on this phone.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => void outbox.discard(id) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
        <Text variant="title">Needs attention</Text>
        {stuck.length === 0 ? <Text>Nothing needs attention.</Text> : null}
        {stuck.map((e) => {
          const copy = attentionCopy(e.attention?.reason ?? "rejected", e.attention?.message ?? "");
          const label = describeCount(e.command.ingredientName, e.command);
          return (
            <View key={e.id} style={{ gap: space.sm, borderBottomWidth: 1, borderBottomColor: c.border, paddingBottom: space.lg }}>
              <Text>{e.command.ingredientName} · {e.command.categoryName}</Text>
              <Text variant="muted">You counted {e.command.rawQty} {e.command.countedUnit}.</Text>
              <Text variant="error">⚠ {copy.sentence}</Text>
              {copy.actions.includes("enter_again") ? <Button label="Enter it again" onPress={() => router.push({ pathname: "/area/[name]", params: { name: e.command.categoryName } })} /> : null}
              {copy.actions.includes("sign_in") ? <Button label="Sign in again" onPress={() => void session.signOut()} /> : null}
              {copy.actions.includes("discard") ? <Button kind="quiet" label="Discard this count" onPress={() => discard(e.id, label)} /> : null}
            </View>
          );
        })}
        {stuck.length > 0 ? <Button kind="quiet" label="Try sending again" onPress={() => { void Promise.all(stuck.map((e) => outbox.retry(e.id))).then(runner.kick); }} /> : null}
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
