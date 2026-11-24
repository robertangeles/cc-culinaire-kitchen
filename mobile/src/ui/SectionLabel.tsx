import { Text } from "./Text";

/** The first app's small copper capitals: a section's name, or a notification's kind. */
export function SectionLabel({ children }: { children: string }) {
  return <Text variant="label">{children}</Text>;
}
