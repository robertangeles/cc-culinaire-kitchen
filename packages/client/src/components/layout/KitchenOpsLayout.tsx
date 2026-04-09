/**
 * @module components/layout/KitchenOpsLayout
 *
 * Shared layout wrapper for all Kitchen Operations pages.
 * Renders the KitchenOpsToolbar (location selector + module name)
 * above the page content. All ops pages inherit this toolbar.
 */

import { type ReactNode } from "react";
import { KitchenOpsToolbar } from "./KitchenOpsToolbar.js";

export function KitchenOpsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <KitchenOpsToolbar />
      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#0A0A0A]">
        <div className="min-h-full">
          {children}
        </div>
      </div>
    </div>
  );
}
