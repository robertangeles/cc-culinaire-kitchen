/**
 * @module components/auth/RequirePermission
 *
 * Route-level permission guard. Renders its children only if the current user
 * holds one of the required permissions; otherwise shows a plain, human
 * "no access" panel instead of silently redirecting (so a shared/deep link
 * doesn't just vanish). This is UX only — the server enforces the same
 * permission on the API, which is the real security boundary.
 */

import { Lock } from "lucide-react";
import { Link } from "react-router";
import { useHasPermission } from "../../hooks/useHasPermission.js";

export function RequirePermission({
  anyOf,
  children,
}: {
  anyOf: string[];
  children: React.ReactNode;
}) {
  const hasPermission = useHasPermission();

  if (hasPermission(...anyOf)) return <>{children}</>;

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-sm w-full text-center rounded-2xl border border-[#1E1E1E] bg-[#111111] px-6 py-10 shadow-[0_16px_50px_-12px_rgba(0,0,0,0.6)]">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#D4A574]/15 border border-[#D4A574]/20">
          <Lock className="size-5 text-[#D4A574]" />
        </div>
        <h2 className="text-lg font-semibold text-white">This tool isn't on your plan</h2>
        <p className="mt-2 text-sm text-[#999999]">
          Your role doesn't include access to this part of the kitchen. Ask an administrator
          to grant it, or head back to your chat.
        </p>
        <Link
          to="/chat/new"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#D4A574] px-4 py-2.5 text-sm font-medium text-[#0A0A0A] hover:bg-[#C4956A] transition-colors"
        >
          Back to Ask Antoine
        </Link>
      </div>
    </div>
  );
}
