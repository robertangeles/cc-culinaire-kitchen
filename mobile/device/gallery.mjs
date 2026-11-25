// Writes <dir>/index.html: one row per screen from the screenshot walk (device/screens.sh), with the phone, iPad portrait and iPad
// landscape images side by side and the web page the screen mirrors. With a second folder (an earlier run), a screen whose image changed
// also shows the earlier one, marked "before". A notes.html in <dir> is shown above the table. Opens straight from disk.
//   node device/gallery.mjs <dir> [<before-dir>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { argv, stdout } from "node:process";

const FORMS = ["phone", "tablet", "tablet-landscape"];
const C = "packages/client/src";
// The image name's number says which screen it is; this says which web page it mirrors.
const WEB = [
  [/^01/, `${C}/pages/LoginPage.tsx, RegisterPage.tsx (/login)`],
  [/^0[23]/, `${C}/pages/ForgotPasswordPage.tsx (/forgot-password)`],
  [/^04/, `/terms and /privacy (PublicPage, surface mobile)`],
  [/^05/, "none: the web has no update screen"],
  [/^06/, `${C}/pages/LoginPage.tsx (MFA step)`],
  [/^07/, "the first tab after sign-in (the web opens on its own home page)"],
  [/^1/, `${C}/components/inventory/StockTakeSession.tsx, CategoryCounter.tsx (/inventory)`],
  [/^2/, `${C}/pages/WasteIntelligencePage.tsx, components/waste (/waste-intelligence)`],
  [/^3/, `${C}/pages/KitchenCopilotPage.tsx, components/copilot (/kitchen-copilot)`],
  [/^4/, `${C}/components/inventory/ConsumptionLogger.tsx (/inventory, Transfers: Internal Usage)`],
  [/^5/, `${C}/components/inventory/StockMovementForm.tsx (/inventory, Move Between Areas)`],
  [/^60/, `${C}/pages/ProfilePage.tsx (/profile)`],
  [/^61/, "none: the web's sidebar holds every page; More is the phone's overflow tab"],
  [/^62/, `${C}/components/location/LocationSwitcher.tsx`],
  [/^6[3-4]/, `${C}/components/profile/DeleteAccountSection.tsx (/profile)`],
  [/^7/, `${C}/components/profile/OrgTab.tsx (join by key)`],
  [/^8[0-4]/, `${C}/pages/ChatPage.tsx (/chat)`],
  [/^8[5-9]/, `${C}/pages/MyShelfPage.tsx, RecipeLabPage.tsx (/my-shelf, /recipes)`],
  [/^9[0-4]/, `${C}/pages/PurchasingPage.tsx (receiving)`],
  [/^m/, `${C}/pages/MenuIntelligencePage.tsx, components/menu, components/menu-intelligence/RecordSaleModal.tsx (/menu-intelligence)`],
  [/^o/, `${C}/pages/PurchasingPage.tsx (/purchasing: Orders, Approvals; credit notes have no web page)`],
  [/^9[5-9]/, `${C}/components/layout/NotificationBell.tsx (the bell)`],
];

const [dirArg, beforeArg] = argv.slice(2);
if (!dirArg) throw new Error("usage: node device/gallery.mjs <dir> [<before-dir>]");
const dir = resolve(dirArg);
const before = beforeArg ? resolve(beforeArg) : undefined;
const pngs = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".png")) : []);
const names = [...new Set(FORMS.flatMap((f) => pngs(resolve(dir, f))))].sort();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function cell(form, name) {
  const now = resolve(dir, form, name);
  if (!existsSync(now)) return `<td class="none">not photographed</td>`;
  const img = (p, label) => `<figure><a href="${esc(relative(dir, p))}"><img loading="lazy" src="${esc(relative(dir, p))}"></a><figcaption>${label}</figcaption></figure>`;
  const old = before && resolve(before, form, name);
  const changed = old && existsSync(old) && !readFileSync(old).equals(readFileSync(now));
  return `<td>${changed ? img(old, "before") + img(now, "after") : img(now, "")}</td>`;
}

// Optional notes for the reader (what was not photographed and why), kept next to the images as notes.html.
const notes = existsSync(resolve(dir, "notes.html")) ? readFileSync(resolve(dir, "notes.html"), "utf8") : "";

const rows = names.map((n) => {
  const title = n.replace(/\.png$/, "");
  const web = WEB.find(([re]) => re.test(title))?.[1] ?? "";
  return `<tr><th>${esc(title)}<div class="web">${esc(web)}</div></th>${FORMS.map((f) => cell(f, n)).join("")}</tr>`;
});

writeFileSync(
  resolve(dir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Phone screens</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px;background:#F3EFE4;color:#101418}
table{border-collapse:collapse}th,td{border-top:1px solid #C9C2B3;padding:8px;vertical-align:top;text-align:left}
th{width:220px}.web{font-weight:400;color:#696D74;margin-top:4px}td.none{color:#696D74}
figure{display:inline-block;margin:0 8px 0 0}img{max-height:520px;max-width:420px;border:1px solid #C9C2B3}figcaption{color:#956134;font-weight:600}
</style>
<h1>Phone screens</h1><p>${names.length} screens. Generated ${new Date().toISOString()} by mobile/device/gallery.mjs. Tablet-width images come from the moto g86 with its display set to iPad sizes (wm size and density), or from the tablet emulator, which is walked in the phone form, so its iPad-width images land in the phone column. A round gear at the top right, where it shows, is the development build's menu button, not the app: release builds do not have it.</p>
${notes}
<table><tr><th>Screen / web page</th>${FORMS.map((f) => `<th>${f}</th>`).join("")}</tr>${rows.join("\n")}</table>\n`,
);
stdout.write(`gallery: ${resolve(dir, "index.html")} (${names.length} screens)\n`);
