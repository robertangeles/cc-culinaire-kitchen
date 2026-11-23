/**
 * Just enough Markdown for the terms and privacy pages the owner writes in Settings, and for chat answers: headings, paragraphs, lists, rules, bold,
 * italic and links. Anything else shows as the plain text it is. No HTML is ever interpreted, and only web and mail links open.
 */

export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  href?: string;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; spans: Span[] }
  | { type: "paragraph"; spans: Span[] }
  | { type: "list"; ordered: boolean; items: Span[][] }
  | { type: "rule" };

const INLINE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|(?<!\w)_([^_\s][^_]*?)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  const plain = (s: string) => s && spans.push({ text: s });
  for (const m of text.matchAll(INLINE)) {
    plain(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] ?? m[2]) spans.push({ text: (m[1] ?? m[2])!, bold: true });
    else if (m[3] ?? m[4]) spans.push({ text: (m[3] ?? m[4])!, italic: true });
    else if (m[5]) spans.push(SAFE_LINK.test(m[6]) ? { text: m[5], href: m[6] } : { text: m[5] });
    else plain(m[7]);
  }
  plain(text.slice(last));
  return spans.reduce<Span[]>((out, s) => {
    const prev = out[out.length - 1];
    if (prev && !s.bold && !s.italic && !s.href && !prev.bold && !prev.italic && !prev.href) prev.text += s.text;
    else out.push(s);
    return out;
  }, []);
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", spans: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const addItem = (ordered: boolean, text: string) => {
    const last = blocks[blocks.length - 1];
    if (last?.type === "list" && last.ordered === ordered) last.items.push(parseInline(text));
    else blocks.push({ type: "list", ordered, items: [parseInline(text)] });
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if (line === "") flush();
    else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      blocks.push({ type: "heading", level: Math.min(m[1].length, 3) as 1 | 2 | 3, spans: parseInline(m[2]) });
    } else if (/^([-*_])(\s*\1){2,}$/.test(line)) {
      flush();
      blocks.push({ type: "rule" });
    } else if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      flush();
      addItem(false, m[1]);
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flush();
      addItem(true, m[1]);
    } else paragraph.push(line.replace(/^>\s?/, ""));
  }
  flush();
  return blocks;
}
