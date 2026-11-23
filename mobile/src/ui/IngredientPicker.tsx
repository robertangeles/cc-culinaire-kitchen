import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { IngredientSource, PickedIngredient } from "../ingredients/source";
import { fontFamily, size, space } from "../theme";
import { Surface, rowDivider } from "./Surface";
import { Text } from "./Text";
import { TextField } from "./TextField";
import { useColors } from "./theme";

interface Props {
  label: string;
  /** What is typed. The picker never owns it: a name that is not in any list is simply what the person typed. */
  value: string;
  onChangeText: (text: string) => void;
  /** The person tapped a suggestion or a recent item. The screen usually copies `name` into `value` and uses `unit`. */
  onPick: (picked: PickedIngredient) => void;
  source: IngredientSource;
  placeholder?: string;
}

const MORE_DELAY_MS = 300;

/**
 * The shared ingredient picker. Empty, it offers recent items; as the person types it shows matches from the phone at once
 * (downloaded catalogue and recent items) and, a moment later, names the server suggests. Works with no signal. Waste uses it
 * now; consumption, transfers and orders use the same component with their own `IngredientSource`.
 */
export function IngredientPicker({ label, value, onChangeText, onPick, source, placeholder }: Props) {
  const c = useColors();
  const [recent, setRecent] = useState<PickedIngredient[]>([]);
  const [matches, setMatches] = useState<PickedIngredient[]>([]);
  /** Set when something was picked, until the person types again, so the list does not reopen over the finished field. */
  const [picked, setPicked] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    let live = true;
    void source.recent().then((r) => live && setRecent(r));
    return () => void (live = false);
  }, [source]);

  useEffect(() => {
    const ticket = ++latest.current;
    const q = value.trim();
    if (picked || !q) {
      setMatches([]);
      return;
    }
    void source.search(q).then((m) => ticket === latest.current && setMatches(m));
    if (!source.searchMore || q.length < 2) return;
    const timer = setTimeout(() => {
      void source.searchMore!(q).then((more) => ticket === latest.current && setMatches((m) => [...m, ...more.filter((x) => !m.some((y) => y.name.toLowerCase() === x.name.toLowerCase()))]));
    }, MORE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value, picked, source]);

  const choose = (p: PickedIngredient) => {
    setPicked(true);
    setMatches([]);
    onPick(p);
  };

  return (
    <View style={styles.wrap}>
      <TextField
        label={label}
        value={value}
        placeholder={placeholder}
        autoCapitalize="sentences"
        autoCorrect={false}
        returnKeyType="next"
        onChangeText={(t) => {
          setPicked(false);
          onChangeText(t);
        }}
      />
      {matches.length > 0 ? (
        <Surface>
          {matches.map((m, i) => (
            <Pressable key={m.name} accessibilityRole="button" accessibilityLabel={`Use ${m.name}`} onPress={() => choose(m)} style={[styles.row, rowDivider(i, c.border)]}>
              <Text style={{ flexShrink: 1 }}>{m.name}</Text>
              {m.unit ? <Text variant="meta">{m.unit}</Text> : null}
            </Pressable>
          ))}
        </Surface>
      ) : null}
      {!value.trim() && recent.length > 0 ? (
        <View style={styles.recent}>
          <Text style={[styles.caps, { color: c.accentText }]}>Recent</Text>
          <View style={styles.chips}>
            {recent.slice(0, 6).map((r) => (
              <Pressable key={r.name} accessibilityRole="button" accessibilityLabel={`Use ${r.name}`} hitSlop={4} onPress={() => choose(r)} style={[styles.chip, { backgroundColor: c.field, borderColor: c.border }]}>
                <Text style={{ fontFamily: fontFamily.uiStrong }}>{r.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { minHeight: size.tap, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingHorizontal: space.lg },
  recent: { gap: space.xs },
  caps: { fontFamily: fontFamily.uiStrong, fontSize: 12, letterSpacing: 1.8, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: 48, borderRadius: 999, borderWidth: 1, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
});
