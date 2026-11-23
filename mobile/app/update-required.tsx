import { Linking, Platform } from "react-native";
import { useSession } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";

/**
 * Shown when the server says this build is too old (426). The store link comes from the 426 body, for this phone's own store only; with
 * none set there is no link, just the name of the store to update from. Nothing here sells anything.
 */
export default function UpdateRequired() {
  const { state } = useSession();
  if (state.phase !== "updateRequired") return null;
  const ios = Platform.OS === "ios";
  const store = ios ? "the App Store" : "Google Play";
  const url = ios ? state.storeUrls?.ios : state.storeUrls?.android;

  return (
    <Screen>
      <Brand size={140} />
      <Text variant="title">Update to continue</Text>
      <Text variant="muted">
        {state.minVersion ? `This version of CulinAIre Kitchen is out of date. Version ${state.minVersion} or later is needed. ` : "This version of CulinAIre Kitchen is out of date. "}
        Anything you counted stays on this phone and is sent after you update.
      </Text>
      {url ? <Button label={`Open ${store}`} onPress={() => void Linking.openURL(url).catch(() => undefined)} /> : <Text>Update CulinAIre Kitchen from {store}.</Text>}
    </Screen>
  );
}
