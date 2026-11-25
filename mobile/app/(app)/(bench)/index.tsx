import { useCallback, useState } from "react";
import { KeyboardAvoidingView, useWindowDimensions, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "../../../src/runtime/appContext";
import { useBench } from "../../../src/bench/BenchProvider";
import type { Room } from "../../../src/bench/benchApi";
import { RoomList } from "../../../src/bench/RoomList";
import { RoomView } from "../../../src/bench/RoomView";
import { Surface } from "../../../src/ui/Surface";
import { Text } from "../../../src/ui/Text";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

/** From this width the open room sits beside the list (an iPad either way up); below it, a room is a screen of its own. */
const TWO_PANE = 768;
const LIST_WIDTH = 320;

/** The Bench: the channels and direct messages, with the open one beside them on a tablet. */
export default function Bench() {
  const { state } = useSession();
  const { store } = useBench();
  const router = useRouter();
  const c = useColors();
  const wide = useWindowDimensions().width >= TWO_PANE;
  const [room, setRoom] = useState<Room | null>(null);
  useFocusEffect(useCallback(() => void store.refreshLists(), [store]));
  if (state.phase !== "ready") return null;

  const open = (next: Room) => {
    if (wide) setRoom(next);
    else router.push({ pathname: "/bench-room", params: next.kind === "dm" ? { thread: String(next.threadId) } : { channel: next.key } });
  };
  if (!wide) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <RoomList selected={null} onOpen={open} />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView style={{ flex: 1, flexDirection: "row" }} behavior="padding">
        <View style={{ width: LIST_WIDTH, borderRightWidth: 1, borderRightColor: c.border }}>
          <RoomList selected={room} onOpen={open} />
        </View>
        <View style={{ flex: 1 }}>
          {room ? (
            <RoomView key={JSON.stringify(room)} room={room} user={state.user} onOpen={open} />
          ) : (
            <View style={{ flex: 1, padding: space.xl }}>
              <Surface>
                <View style={{ padding: space.lg, gap: space.xs }}>
                  <Text variant="heading">Choose a conversation</Text>
                  <Text variant="muted">Your kitchen's channel, everyone, or a direct message opens here.</Text>
                </View>
              </Surface>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
