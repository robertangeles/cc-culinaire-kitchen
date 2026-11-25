import { useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import type { BenchMessage } from "@culinaire/shared/schemas/bench";
import type { AuthUser } from "../api/auth";
import { fontFamily, fontSize, radius, size, space } from "../theme";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Text } from "../ui/Text";
import { caret } from "../ui/TextField";
import { useColors } from "../ui/theme";
import { MAX_BODY } from "./benchStore";
import { EMOJI, canDelete, canEdit, emojiLabel, emojiOf, timeOf } from "./benchView";

export interface MessageActions {
  /** False when it could not go out (the room says why). */
  react(emoji: string): boolean;
  edit(text: string): boolean;
  remove(): boolean;
  /** Absent where this person cannot pin. */
  pin?: () => void;
  pinned: boolean;
  /** Absent unless the two share a kitchen or already have a thread. */
  write?: () => void;
}

/** The words, with one's own @name in copper. */
function Body({ text, me }: { text: string; me: string }) {
  const c = useColors();
  const tag = `@${me}`;
  if (!me || !text.includes(tag)) return <Text>{text}</Text>;
  const parts = text.split(tag);
  return (
    <Text>
      {parts.map((part, i) => (
        <Text key={i}>
          {part}
          {i < parts.length - 1 ? <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>{tag}</Text> : null}
        </Text>
      ))}
    </Text>
  );
}

/** A message: who, when, what, and its reactions; tapped, what this person may do with it. */
export function MessageRow({ message, user, reactions: withReactions, open, onToggle, actions }: { message: BenchMessage; user: AuthUser; reactions: boolean; open: boolean; onToggle: () => void; actions: MessageActions }) {
  const c = useColors();
  const [draft, setDraft] = useState<string | null>(null);
  const own = message.userId === user.userId;
  const body = message.messageType === "recipe_share" ? `${message.recipeTitle ? `Recipe: ${message.recipeTitle}` : "Shared a recipe"}${message.messageBody ? `\n${message.messageBody}` : ""}` : message.messageBody;

  const confirmRemove = () =>
    Alert.alert("Delete this message?", own ? "It goes for everyone here, on the web too." : `${message.userName}'s message goes for everyone here, on the web too.`, [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void (actions.remove() && onToggle()) },
    ]);

  const quiet = (label: string, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" onPress={onPress} style={{ minHeight: size.tap, justifyContent: "center" }}>
      <Text style={{ fontFamily: fontFamily.uiStrong, color: c.accentText }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ paddingVertical: space.sm, gap: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${message.userName}, ${timeOf(message.createdDttm)}: ${body}${message.editedInd ? ", edited" : ""}`}
        onPress={onToggle}
        style={({ pressed }) => ({ flexDirection: "row", gap: space.md, minHeight: size.tap, opacity: pressed ? 0.6 : 1 })}
      >
        <Avatar photoPath={message.userPhotoPath} name={message.userName} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: space.sm }}>
            <Text style={{ fontFamily: fontFamily.uiStrong }}>{message.userName}</Text>
            <Text variant="meta">{`${timeOf(message.createdDttm)}${message.editedInd ? " · edited" : ""}`}</Text>
          </View>
          {draft === null ? <Body text={body} me={user.userName} /> : null}
        </View>
      </Pressable>

      <View style={{ marginLeft: 40 + space.md, gap: space.xs }}>
        {withReactions && message.reactions.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {message.reactions.map((r) => {
              const mine = r.userIds.includes(user.userId);
              return (
                <Pressable
                  key={r.emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`${emojiLabel(r.emoji)}, ${r.userIds.length}${mine ? ", yours" : ""}`}
                  hitSlop={8}
                  onPress={() => void actions.react(r.emoji)}
                  style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: space.xs, borderRadius: 999, borderWidth: 1, borderColor: mine ? c.accentText : c.border, backgroundColor: c.field, paddingHorizontal: space.md }}
                >
                  <Text>{emojiOf(r.emoji)}</Text>
                  <Text style={{ fontFamily: fontFamily.uiStrong, color: mine ? c.accentText : c.textMuted }}>{String(r.userIds.length)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {draft !== null ? (
          <View style={{ gap: space.sm }}>
            <TextInput
              {...caret(c)}
              accessibilityLabel="Edit your message"
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={MAX_BODY}
              style={{ minHeight: size.tap, borderRadius: radius.banner, borderWidth: 1, borderColor: c.buttonFrom, backgroundColor: c.field, color: c.text, fontFamily: fontFamily.ui, fontSize: fontSize.body, paddingHorizontal: space.lg, paddingVertical: space.md }}
            />
            <Button
              label="Save"
              disabled={!draft.trim()}
              onPress={() => {
                if (draft.trim() !== message.messageBody && !actions.edit(draft)) return;
                setDraft(null);
                onToggle();
              }}
            />
            <Button kind="quiet" label="Cancel" onPress={() => setDraft(null)} />
          </View>
        ) : open ? (
          <View style={{ gap: space.xs }}>
            {withReactions ? (
              // Two rows of four.
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, maxWidth: 4 * size.tap + 3 * space.sm }}>
                {EMOJI.map((e) => (
                  <Pressable
                    key={e.key}
                    accessibilityRole="button"
                    accessibilityLabel={`React ${e.label}`}
                    onPress={() => void (actions.react(e.key) && onToggle())}
                    style={({ pressed }) => ({ width: size.tap, height: size.tap, borderRadius: size.tap / 2, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? c.field : c.surface, borderWidth: 1, borderColor: c.border })}
                  >
                    <Text style={{ fontSize: 22 }}>{e.display}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.xl }}>
              {actions.write ? quiet(`Message ${message.userName}`, actions.write) : null}
              {actions.pin ? quiet(actions.pinned ? "Unpin" : "Pin", actions.pin) : null}
              {canEdit(user, message) ? quiet("Edit", () => setDraft(message.messageBody)) : null}
              {canDelete(user, message) ? quiet("Delete", confirmRemove) : null}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
