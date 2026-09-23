import { motion } from "framer-motion";

/**
 * Sized honestly for one real customer rather than a multi-logo row implying
 * a customer base that doesn't exist yet (docs/designs/landing-page-hospitality-redesign.md).
 * Re-expand to a logo row once 2-3 more customers are on board.
 */
export function TrustStrip() {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      viewport={{ once: true, margin: "-40px" }}
      className="border-y border-cocoa-200 bg-cocoa-50 py-6"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-4 px-6 sm:flex-row">
        <span className="text-xs font-semibold uppercase tracking-widest text-copper">
          Featured customer
        </span>
        <div className="flex items-center gap-3">
          <img
            src="/logos/almost-french-patisserie.png"
            alt="Almost French Patisserie logo"
            className="h-24 w-auto rounded-md"
          />
          <div className="flex flex-col">
            <span className="font-display text-base font-semibold text-white">
              Almost French Patisserie
            </span>
            <span className="text-sm text-cocoa-500">
              Running prep planning on CulinAIre Kitchen
            </span>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
