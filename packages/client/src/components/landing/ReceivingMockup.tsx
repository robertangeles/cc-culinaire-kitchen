import { motion } from "framer-motion";

/**
 * Real app screenshot (packages/client/public/screenshots/receiving-checklist-screen.png),
 * captured via Playwright against a real purchase order (PO-MUEP5FIZ, Bidfood Melbourne)
 * created, sent, and partially received through the live Purchasing → Receive flow — not
 * a hand-built mockup. See docs/designs/landing-page-hospitality-redesign.md.
 */
export function ReceivingMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-cocoa-200 bg-cocoa-50 shadow-2xl shadow-black/30"
    >
      <div className="h-[420px] w-full overflow-hidden bg-cocoa">
        <img
          src="/screenshots/receiving-checklist-screen.png"
          alt="CulinAIre Kitchen receiving checklist, showing a delivery with one item flagged short and the rest confirmed"
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-left-top"
        />
      </div>
    </motion.div>
  );
}
