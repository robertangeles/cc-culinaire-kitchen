import { Stack } from "expo-router";
import { ChatProvider } from "../../../src/chat/ChatProvider";

/** The chat module: the saved conversations and one conversation, sharing one chat API. */
export default function ChatLayout() {
  return (
    <ChatProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ChatProvider>
  );
}
