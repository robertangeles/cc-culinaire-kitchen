import { motion } from "framer-motion";

/**
 * Real app screenshot (packages/client/public/screenshots/prep-inventory-screen.png),
 * captured via Playwright against the live Inventory dashboard, not a hand-built
 * mockup — see docs/designs/landing-page-hospitality-redesign.md.
 */
export function PhoneMockup() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Corner badge — top-right: real alert copy, from the screenshot's own "Critical" count.
          Anchored to the frame's corner (not a mid-height offset) so it clears the real
          screenshot content inside regardless of the frame's height. */}
      <div className="absolute -right-4 -top-4 z-20 w-40 rounded-xl border border-amber-500/20 bg-cocoa-50/95 p-2.5 shadow-lg shadow-black/30 max-[900px]:hidden">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            Critical stock
          </span>
        </div>
        <p className="text-xs text-cocoa-600">19 items — reorder now</p>
      </div>

      {/* Corner badge — bottom-left: real setup-progress copy, from the screenshot */}
      <div className="absolute -bottom-4 -left-4 z-20 w-40 rounded-xl border border-copper/20 bg-cocoa-50/95 p-2.5 shadow-lg shadow-black/30 max-[900px]:hidden">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-copper" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-copper">
            Setup progress
          </span>
        </div>
        <p className="text-xs text-cocoa-600">3 of 4 steps complete</p>
      </div>

      {/* Phone frame */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 w-full max-w-[280px] rounded-[28px] border border-cocoa-200 bg-cocoa-50 p-3 shadow-2xl shadow-black/40"
      >
        {/* Notch */}
        <div className="mx-auto mb-3 h-5 w-24 rounded-b-xl bg-cocoa" />

        {/* Real app screenshot — captured live via Playwright against /inventory */}
        <div className="h-[520px] w-full overflow-hidden rounded-[16px] bg-cocoa">
          <img
            src="/screenshots/prep-inventory-screen.png"
            alt="CulinAIre Kitchen inventory dashboard, showing setup progress, per-location stock, and critical/low-stock alerts"
            className="h-full w-full object-cover object-top"
          />
        </div>
      </motion.div>
    </div>
  );
}
