import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SalesCsvPreview, SalesCsvReport, UnitsImport } from "@culinaire/shared/schemas/menu";
import { ApiError } from "../../../src/api/client";
import { useSession } from "../../../src/runtime/appContext";
import { hasAnyPermission } from "../../../src/shell/tabs";
import { useMenu } from "../../../src/menu/MenuProvider";
import type { CsvFile } from "../../../src/menu/menuApi";
import { mayHaveLanded } from "../../../src/menu/menuEditor";
import { isOffline } from "../../../src/menu/menuStore";
import { amount } from "../../../src/menu/menuView";
import { pickCsv } from "../../../src/menu/pickCsv";
import { Button } from "../../../src/ui/Button";
import { Column } from "../../../src/ui/Column";
import { Text } from "../../../src/ui/Text";
import { Surface, rowDivider } from "../../../src/ui/Surface";
import { space } from "../../../src/theme";
import { useColors } from "../../../src/ui/theme";

const failure = (err: unknown) =>
  isOffline(err) ? "This needs a connection, and the server can't be reached. Try again when you're back online." : err instanceof Error ? err.message : "Something went wrong. Try again.";

/**
 * A sales CSV picked in the system's document picker, read on the phone and sent as the web sends it; the file is never kept.
 * `kind=sales` (Record a sale, `menu:read`): rows of item, quantity and an optional time, matched first, then recorded as sales, their
 * recipes coming off stock. `kind=units` (the dashboard, `menu:manage`): each item's units sold set from the file, stock untouched.
 */
export default function MenuImport() {
  const { state } = useSession();
  const { store } = useMenu();
  const router = useRouter();
  const c = useColors();
  const params = useLocalSearchParams<{ kind?: string }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SalesCsvPreview | null>(null);
  const [report, setReport] = useState<SalesCsvReport | null>(null);
  const [units, setUnits] = useState<UnitsImport | null>(null);
  if (state.phase !== "ready") return null;
  const kind = (Array.isArray(params.kind) ? params.kind[0] : params.kind) === "units" && hasAnyPermission(state.user, ["menu:manage"]) ? "units" : "sales";

  async function choose() {
    setError(null);
    const pick = await pickCsv();
    if (pick.kind === "cancelled") return;
    if (pick.kind === "refused") return setError(pick.reason);
    setPreview(null);
    setReport(null);
    setUnits(null);
    await send(kind === "units" ? "Importing…" : "Matching the rows…", pick.csv);
  }

  async function send(doing: string, csv: CsvFile) {
    setBusy(doing);
    try {
      if (kind === "units") setUnits(await store.importUnits(csv));
      else setPreview(await store.previewSales(csv));
    } catch (err) {
      setError(failure(err));
    }
    setBusy(null);
  }

  async function record(lines: SalesCsvPreview["matched"]) {
    setBusy("Recording the sales…");
    setError(null);
    try {
      setReport(await store.commitSales(lines));
    } catch (err) {
      // With no answer some rows may be recorded: sending again records none of them twice.
      setError(err instanceof ApiError && mayHaveLanded(err) ? "No answer from the server, so some rows may be recorded. Send them again: a row already recorded is not recorded twice." : failure(err));
    }
    setBusy(null);
  }

  const card = (heading: string, rows: { key: string; text: string; meta?: string }[]) => (
    <View style={{ gap: space.xs }}>
      <Text variant="label">{heading}</Text>
      <Surface>
        {rows.map((r, index) => (
          <View key={r.key} style={[{ paddingVertical: space.md, paddingHorizontal: space.lg, gap: 2 }, rowDivider(index, c.border)]}>
            <Text>{r.text}</Text>
            {r.meta ? <Text variant="meta">{r.meta}</Text> : null}
          </View>
        ))}
      </Surface>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.xl }}>
        <Column style={{ gap: space.lg }}>
          <Text variant="title">{kind === "units" ? "Import units sold" : "Import sales"}</Text>
          <Text variant="muted">
            {kind === "units"
              ? "A CSV with a header row and columns for the item's name and its units sold. Each item's units sold becomes the file's number, then the menu is classified again. Stock is not changed."
              : `A CSV with one sale a row: the menu item's name, how many sold and, if you like, when. Each row is recorded as a sale at ${state.location.locationName}, and its recipe comes off stock. You see the matches before anything is recorded.`}
          </Text>

          {report ? (
            <>
              <Surface>
                <View style={{ padding: space.lg, gap: space.xs }} accessibilityLiveRegion="polite">
                  <Text variant="heading">{`${report.succeeded.length} recorded`}</Text>
                  <Text variant="meta">{`${report.alreadyExists.length} already imported · ${report.failed.length} not recorded`}</Text>
                </View>
              </Surface>
              {report.failed.length > 0 ? card("Not recorded", report.failed.map((f) => ({ key: String(f.rowIndex), text: `Row ${f.rowIndex + 1}`, meta: f.reason }))) : null}
            </>
          ) : null}

          {units ? (
            <>
              <Surface>
                <View style={{ padding: space.lg, gap: space.xs }} accessibilityLiveRegion="polite">
                  <Text variant="heading">{`${units.updated} ${units.updated === 1 ? "item" : "items"} updated`}</Text>
                  {units.notFound.length > 0 ? <Text variant="meta">{`${units.notFound.length} not matched`}</Text> : null}
                </View>
              </Surface>
              {units.notFound.length > 0 ? card("Not matched", units.notFound.map((name, i) => ({ key: `${i}`, text: name }))) : null}
            </>
          ) : null}

          {preview && !report ? (
            <>
              {preview.matched.length > 0
                ? card(`${preview.matched.length} matched`, preview.matched.map((m) => ({ key: String(m.rowIndex), text: `${m.name} × ${amount(m.qtySold)}`, meta: m.soldAt ? `Sold ${m.soldAt}` : undefined })))
                : (
                  <Surface>
                    <View style={{ padding: space.lg, gap: space.xs }}>
                      <Text variant="heading">Nothing matched</Text>
                      <Text variant="muted">No row names an item on the menu. Check the names and pick the file again.</Text>
                    </View>
                  </Surface>
                )}
              {preview.unmatched.length > 0 ? card(`${preview.unmatched.length} not matched`, preview.unmatched.map((u) => ({ key: String(u.rowIndex), text: u.name || `Row ${u.rowIndex + 1}`, meta: u.reason }))) : null}
              {preview.matched.length > 0 ? <Button label={`Record ${preview.matched.length} ${preview.matched.length === 1 ? "sale" : "sales"}`} disabled={busy !== null} onPress={() => void record(preview.matched)} /> : null}
            </>
          ) : null}

          {busy ? <Text variant="muted" accessibilityLiveRegion="polite">{busy}</Text> : null}
          {error ? <Text variant="error" accessibilityLiveRegion="polite">{error}</Text> : null}
          <Button kind={preview || units || report ? "quiet" : "primary"} label={preview || units || report ? "Choose another file" : "Choose a CSV file"} disabled={busy !== null} onPress={() => void choose()} />
          <Button kind="quiet" label="Back" onPress={() => router.back()} />
        </Column>
      </ScrollView>
    </SafeAreaView>
  );
}
