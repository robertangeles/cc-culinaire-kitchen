import { KeyboardAvoidingView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import type { Room } from "../../../src/bench/benchApi";
import { RoomView } from "../../../src/bench/RoomView";
import { useColors } from "../../../src/ui/theme";

/** One room on a phone. A direct message opened from here takes its place, so Back is always the list. */
export default function BenchRoom() {
  const { state } = useSession();
  const { channel, thread } = useLocalSearchParams<{ channel?: string; thread?: string }>();
  const router = useRouter();
  const c = useColors();
  if (state.phase !== "ready") return null;
  const room: Room = thread ? { kind: "dm", threadId: Number(thread) } : { kind: "channel", key: channel ?? "everyone" };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <RoomView
          key={JSON.stringify(room)}
          room={room}
          user={state.user}
          onBack={() => router.back()}
          onOpen={(next) => router.replace({ pathname: "/bench-room", params: next.kind === "dm" ? { thread: String(next.threadId) } : { channel: next.key } })}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
