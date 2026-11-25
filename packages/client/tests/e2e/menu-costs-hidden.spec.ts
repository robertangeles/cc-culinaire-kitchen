/**
 * Menu costs, margins and line costs are for holders of inventory:cost; everyone else with menu:read keeps the rest.
 *
 * Signs in as a real second person: registered through the API, given a role made here that holds menu:read only,
 * and joined to the E2E user's organisation. The dish is the E2E user's (an Administrator, so a holder).
 */
import { request, type APIRequestContext } from "@playwright/test";
import { test, expect } from "./_helpers/test";
import { apiCall } from "./_helpers/data";
import { currentPrefix, e2eBaseUrl } from "./_helpers/safety";

test.use({ storageState: { cookies: [], origins: [] } });

const password = "E2e-Menu-Reader-Pass-1!";
const dish = () => `${currentPrefix()}risotto`;
const email = () => `${currentPrefix()}menu-reader@culinaire.test`;

async function seedDish(api: APIRequestContext, defer: (label: string, undo: () => Promise<void>) => void) {
  const { menuItemId } = await apiCall<{ menuItemId: string }>(api, "POST", "/api/menu/items", { name: dish(), category: "Mains", sellingPrice: "24.00" });
  defer("menu item", () => apiCall(api, "DELETE", `/api/menu/items/${menuItemId}`));
  await apiCall(api, "POST", `/api/menu/items/${menuItemId}/ingredients`, { ingredientName: "Rice", quantity: "0.5", unit: "kg", unitCost: "12.22" }); // $6.11, margin $17.89
  return menuItemId;
}

async function seedReader(api: APIRequestContext, defer: (label: string, undo: () => Promise<void>) => void) {
  const { permissions } = await apiCall<{ permissions: Array<{ permissionId: number; permissionKey: string }> }>(api, "GET", "/api/permissions");
  const { role } = await apiCall<{ role: { roleId: number } }>(api, "POST", "/api/roles", { roleName: `${currentPrefix()}menu reader` });
  defer("role", () => apiCall(api, "DELETE", `/api/roles/${role.roleId}`));
  await apiCall(api, "PUT", `/api/roles/${role.roleId}/permissions`, { permissionIds: permissions.filter((p) => p.permissionKey === "menu:read").map((p) => p.permissionId) });

  const anonymous = await request.newContext({ baseURL: e2eBaseUrl() });
  const { userId } = await apiCall<{ userId: number }>(anonymous, "POST", "/api/auth/register", { name: "E2E Menu Reader", email: email(), password });
  await anonymous.dispose();
  defer("user", () => apiCall(api, "DELETE", `/api/users/${userId}`));
  const { roles } = await apiCall<{ roles: Array<{ roleId: number; roleName: string }> }>(api, "GET", "/api/roles");
  await apiCall(api, "DELETE", `/api/users/${userId}/roles/${roles.find((r) => r.roleName === "Subscriber")!.roleId}`);
  await apiCall(api, "POST", `/api/users/${userId}/roles`, { roleId: role.roleId });
  defer("user's role", () => apiCall(api, "DELETE", `/api/users/${userId}/roles/${role.roleId}`));
  return userId;
}

test("a person with menu:read and no inventory:cost gets the menu without its costs; a holder gets them", async ({ page, api, defer }) => {
  const menuItemId = await seedDish(api, defer);
  const userId = await seedReader(api, defer);

  const reader = page.context().request;
  await apiCall(reader, "POST", "/api/auth/login", { email: email(), password });
  const { organisation } = await apiCall<{ organisation: { joinKey: string } }>(api, "GET", "/api/organisations/mine");
  await apiCall(reader, "POST", "/api/organisations/join", { joinKey: organisation.joinKey });
  const { selectedLocationId } = await apiCall<{ selectedLocationId: string }>(api, "GET", "/api/users/location-context");
  await apiCall(api, "POST", `/api/store-locations/${selectedLocationId}/staff`, { userId });
  await apiCall(reader, "PUT", "/api/users/kitchen-profile", { onboardingDoneInd: true });

  // The server is the boundary: the fields are not in the answer at all, and they are for the holder.
  type Item = Record<string, unknown> & { menuItemId: string };
  const costs = ["foodCost", "foodCostPct", "contributionMargin"];
  for (const [who, expected] of [[reader, []], [api, costs]] as const) {
    const items = await apiCall<Item[]>(who, "GET", "/api/menu/items");
    const mine = items.find((i) => i.menuItemId === menuItemId)!;
    expect(mine.sellingPrice).toBe("24.00");
    expect(costs.filter((k) => k in mine)).toEqual(expected);
  }

  await page.goto("/menu-intelligence");
  await expect(page.getByText("Costs and margins are hidden")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Avg Food Cost")).toHaveCount(0);

  await page.getByRole("button", { name: "Menu Items", exact: true }).click();
  const row = page.getByRole("row", { name: new RegExp(dish()) });
  await expect(row).toContainText("$24.00");
  for (const figure of ["6.11", "17.89", "25.5", "NaN"]) await expect(row).not.toContainText(figure);
  await expect(page.getByRole("columnheader", { name: "Food Cost" })).toHaveCount(0);

  await page.getByRole("button", { name: "Engineering Matrix", exact: true }).click();
  await expect(page.getByText("Costs and margins are hidden")).toBeVisible();
});
