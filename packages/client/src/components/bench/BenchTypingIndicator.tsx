/**
 * Typing indicator: "Chef Marco is writing..."
 */

interface BenchTypingIndicatorProps {
  typingUsers: { userId: number; userName: string }[];
}

export function BenchTypingIndicator({ typingUsers }: BenchTypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const names = typingUsers.map((u) => u.userName);
  let text: string;
  if (names.length === 1) {
    text = `${names[0]} is writing...`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are writing...`;
  } else {
    text = `${names[0]} and ${names.length - 1} others are writing...`;
  }

  return (
    <div className="px-4 py-1.5 text-xs text-[#666666] italic flex items-center gap-2">
      <span className="flex gap-0.5">
        <span className="size-1.5 bg-[#D4A574] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
        <span className="size-1.5 bg-[#D4A574] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
        <span className="size-1.5 bg-[#D4A574] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
      </span>
      {text}
    </div>
  );
}
