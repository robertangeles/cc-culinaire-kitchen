import { Linking, Text as RNText, View } from "react-native";
import { parseMarkdown, type Block, type Span } from "../legal/markdown";
import { fontFamily, space } from "../theme";
import { Text } from "./Text";
import { useColors } from "./theme";

/** Pieces of a line, in the size and font of the line they are in (React Native's own Text: ours sets its own, and a heading's words came out as body text). */
function Spans({ spans }: { spans: Span[] }) {
  const c = useColors();
  return (
    <>
      {spans.map((s, i) => (
        <RNText
          key={i}
          accessibilityRole={s.href ? "link" : undefined}
          onPress={s.href ? () => void Linking.openURL(s.href!).catch(() => undefined) : undefined}
          style={[s.bold && { fontFamily: fontFamily.title }, s.italic && { fontStyle: "italic" }, s.href && { color: c.accentText, textDecorationLine: "underline" }]}
        >
          {s.text}
        </RNText>
      ))}
    </>
  );
}

/** Parsed Markdown (`legal/markdown.ts`) as native text: headings, paragraphs, lists, rules, bold, italic, safe links. */
export function MarkdownBlocks({ blocks }: { blocks: Block[] }) {
  const c = useColors();
  return (
    <>
      {blocks.map((b, i) => {
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
      })}
    </>
  );
}

/** Markdown text (a chat answer), parsed on every render: answers are short and change while they stream. */
export function Markdown({ text }: { text: string }) {
  return <MarkdownBlocks blocks={parseMarkdown(text)} />;
}
