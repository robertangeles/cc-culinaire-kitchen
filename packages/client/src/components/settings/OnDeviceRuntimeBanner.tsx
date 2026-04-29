/**
 * @module OnDeviceRuntimeBanner
 *
 * Read-only banner displayed in place of the AI Model selector when a
 * prompt's runtime is 'device'. Tells the admin that this prompt is
 * consumed by the mobile companion app's on-device model and that the
 * server does not invoke a model for it. The banner is intentionally
 * passive — there is no setting to flip; runtime is fixed at creation
 * time in v1.
 */

import { Smartphone } from "lucide-react";

export function OnDeviceRuntimeBanner() {
  return (
    <div
      role="status"
      className="
        flex items-start gap-3
        rounded-lg border border-[#D4A574]/30 bg-[#D4A574]/5
        px-4 py-3 max-w-md
      "
    >
      <Smartphone className="size-4 mt-0.5 flex-shrink-0 text-[#D4A574]" />
      <div className="text-sm leading-relaxed">
        <p className="font-medium text-[#FAFAFA]">On-Device Runtime</p>
        <p className="mt-0.5 text-[#999999]">
          This prompt runs on a local model on the user&apos;s mobile device.
          The server does not invoke a model for it. Body changes deploy to
          mobile clients via the mobile prompt-fetch route the next time the
          app refreshes its cache.
        </p>
      </div>
    </div>
  );
}
