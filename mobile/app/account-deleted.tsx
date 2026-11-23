import { session } from "../src/runtime/appContext";
import { Brand } from "../src/ui/Brand";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";

/** The result of deleting the account. The phone is already cleared; this is the one thing left to read. */
export default function AccountDeleted() {
  return (
    <Screen>
      <Brand size={140} />
      <Text variant="title">Your account has been deleted</Text>
      <Text variant="muted">Your name and email are removed, and everything saved on this phone is erased. Business records such as orders and stock history stay, with no name attached.</Text>
      <Button label="Done" onPress={() => session.leaveDeletedAccount()} />
    </Screen>
  );
}
