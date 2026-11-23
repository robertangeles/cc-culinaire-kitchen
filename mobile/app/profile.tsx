import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { ProfileDetailField, ProfileDetails } from "@culinaire/shared/schemas/account";
import { accountApi, session, useSession } from "../src/runtime/appContext";
import { ApiError } from "../src/api/client";
import { pickImage } from "../src/profile/pickImage";
import { Screen } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { TextField } from "../src/ui/TextField";
import { Button } from "../src/ui/Button";
import { Avatar } from "../src/ui/Avatar";
import { SectionLabel } from "../src/ui/SectionLabel";
import { space } from "../src/theme";

/** The fields in the order the web's Account Details tab shows them, with the server's limits. */
const SECTIONS: { title: string; fields: { key: ProfileDetailField; label: string; max: number; url?: true; multiline?: true }[] }[] = [
  { title: "About you", fields: [{ key: "userName", label: "Name", max: 100 }, { key: "userBio", label: "Bio", max: 300, multiline: true }] },
  {
    title: "Address",
    fields: [
      { key: "userAddressLine1", label: "Address line 1", max: 200 },
      { key: "userAddressLine2", label: "Address line 2", max: 200 },
      { key: "userSuburb", label: "Suburb or city", max: 100 },
      { key: "userState", label: "State or province", max: 100 },
      { key: "userCountry", label: "Country", max: 100 },
      { key: "userPostcode", label: "Postcode", max: 20 },
    ],
  },
  {
    title: "Social media",
    fields: [
      { key: "userFacebook", label: "Facebook", max: 500, url: true },
      { key: "userInstagram", label: "Instagram", max: 500, url: true },
      { key: "userTiktok", label: "TikTok", max: 500, url: true },
      { key: "userPinterest", label: "Pinterest", max: 500, url: true },
      { key: "userLinkedin", label: "LinkedIn", max: 500, url: true },
    ],
  },
];

const PICK_FAILED = {
  denied: "The camera isn't allowed for CulinAIre Kitchen. Allow it in your phone's settings, or choose a photo instead.",
  unsupported: "That picture's format can't be used. Choose a JPEG or PNG photo.",
};

/** My details: picture, name, bio, address and social links (the web's Profile > Account Details). */
export default function Profile() {
  const router = useRouter();
  const { state } = useSession();
  const [details, setDetails] = useState<ProfileDetails | "failed" | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: true }>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void accountApi.details().then(
      ({ userEmail: _email, userPhotoPath: _photo, ...fields }) => setDetails(fields),
      () => setDetails("failed"),
    );
  }, []);

  if (state.phase !== "ready") return null;
  const { user } = state;
  if (details === null || details === "failed") {
    return (
      <Screen>
        <Text variant="title">My details</Text>
        {details === null ? <Text variant="muted">Loading…</Text> : <Text variant="error">Couldn't load your details. Check your signal and try again.</Text>}
        <Button kind="quiet" label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  async function changePicture(from: "library" | "camera") {
    setMessage(undefined);
    const picked = await pickImage(from).catch(() => ({ kind: "cancelled" as const }));
    if (picked.kind === "cancelled") return;
    if (picked.kind !== "picked") return setMessage({ text: PICK_FAILED[picked.kind], error: true });
    setUploading(true);
    try {
      await accountApi.uploadAvatar(picked.image);
      await session.refreshUser();
      setMessage({ text: "Picture updated." });
    } catch (err) {
      setMessage({ text: err instanceof ApiError && err.code === "bad_request" ? err.message : "Couldn't upload the picture. Check your signal and try again.", error: true });
    } finally {
      setUploading(false);
    }
  }

  const current = details;
  const nameMissing = current.userName.trim() === "";
  async function save() {
    setSaving(true);
    setMessage(undefined);
    try {
      await accountApi.saveDetails({ ...current, userName: current.userName.trim() });
      await session.refreshUser();
      setMessage({ text: "Your details are saved." });
    } catch (err) {
      setMessage({ text: err instanceof ApiError && (err.code === "network" || err.code === "timeout") ? err.message : "Couldn't save. Check the fields and try again.", error: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text variant="title">My details</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
        <Avatar photoPath={user.userPhotoPath} name={current.userName || user.userName} size={88} />
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="meta">{user.userEmail}</Text>
          <Button kind="quiet" label={uploading ? "Uploading…" : "Choose photo"} disabled={uploading} onPress={() => void changePicture("library")} />
          <Button kind="quiet" label="Take photo" disabled={uploading} onPress={() => void changePicture("camera")} />
        </View>
      </View>
      {SECTIONS.map((section) => (
        <View key={section.title} style={{ gap: space.md }}>
          <SectionLabel>{section.title}</SectionLabel>
          {section.fields.map((f) => (
            <TextField
              key={f.key}
              label={f.key === "userBio" ? `${f.label} (${current.userBio.length}/300)` : f.label}
              value={current[f.key]}
              maxLength={f.max}
              multiline={f.multiline}
              autoCapitalize={f.url ? "none" : undefined}
              autoCorrect={f.url ? false : undefined}
              keyboardType={f.url ? "url" : undefined}
              placeholder={f.url ? `https://${f.label.toLowerCase()}.com/…` : undefined}
              onChangeText={(v) => setDetails({ ...current, [f.key]: v })}
            />
          ))}
        </View>
      ))}
      {nameMissing ? <Text variant="error">Your name can't be empty.</Text> : null}
      {message ? (
        <Text variant={message.error ? "error" : "meta"} accessibilityLiveRegion="polite">
          {message.text}
        </Text>
      ) : null}
      <Button label={saving ? "Saving…" : "Save"} disabled={saving || nameMissing} onPress={() => void save()} />
      <Button kind="quiet" label="Back" onPress={() => router.back()} />
    </Screen>
  );
}
