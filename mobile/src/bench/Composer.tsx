import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import type { BenchPerson } from "@culinaire/shared/schemas/bench";
import { fontFamily, fontSize, radius, size, space } from "../theme";
import { Avatar } from "../ui/Avatar";
import { Column } from "../ui/Column";
import { Surface, rowDivider } from "../ui/Surface";
import { Text } from "../ui/Text";
import { caret } from "../ui/TextField";
import { useColors } from "../ui/theme";
import { MAX_BODY } from "./benchStore";
import { insertMention, mentionQuery, peopleMatching } from "./benchView";

/** Where a post is written. An @ offers the people of this room; the name goes in as plain text, as on the web. */
export function Composer({ placeholder, people, onTyping, onPost }: { placeholder: string; people: BenchPerson[]; onTyping: () => void; onPost: (text: string) => boolean }) {
  const c = useColors();
  const [draft, setDraft] = useState("");
  const query = mentionQuery(draft);
  const offered = query === null ? [] : peopleMatching(people, query);
  const ready = draft.trim() !== "";

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface, paddingVertical: space.md, paddingHorizontal: space.xl, gap: space.sm }}>
      {offered.length > 0 ? (
        <Column>
          <Surface>
            {offered.map((p, i) => (
              <Pressable key={p.userId} accessibilityRole="button" accessibilityLabel={`Mention ${p.userName}`} onPress={() => setDraft(insertMention(draft, p.userName))} style={[{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg }, rowDivider(i, c.border)]}>
                <Avatar photoPath={p.userPhotoPath} name={p.userName} size={32} />
                <Text style={{ fontFamily: fontFamily.uiStrong }}>{p.userName}</Text>
              </Pressable>
            ))}
          </Surface>
        </Column>
      ) : null}
      <Column style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        <TextInput
          {...caret(c)}
          accessibilityLabel="Your message"
          placeholder={placeholder}
          placeholderTextColor={c.textMuted}
          value={draft}
          onChangeText={(t) => {
            setDraft(t);
            onTyping();
          }}
          multiline
          maxLength={MAX_BODY}
          style={{ flex: 1, minHeight: size.tap, maxHeight: 160, borderRadius: radius.banner, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, color: c.text, fontFamily: fontFamily.ui, fontSize: fontSize.body, paddingHorizontal: space.lg, paddingTop: 16, paddingBottom: 16 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={() => onPost(draft) && setDraft("")}
          style={({ pressed }) => ({ minWidth: 72, minHeight: size.tap, borderRadius: radius.button, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, backgroundColor: c.buttonFrom, opacity: !ready ? 0.5 : pressed ? 0.8 : 1 })}
        >
          <Text style={{ fontFamily: fontFamily.uiStrong, color: c.buttonText }}>Send</Text>
        </Pressable>
      </Column>
    </View>
  );
}
