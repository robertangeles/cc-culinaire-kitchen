import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { convertUnit } from "@culinaire/shared";

// Scaffold screen (PR 2): the unit line proves Metro resolves @culinaire/shared. PR 3 replaces this with sign-in.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>CulinAIre Kitchen</Text>
      <Text>1 kg = {convertUnit(1, "kg", "g")} g</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "600", marginBottom: 8 },
});
