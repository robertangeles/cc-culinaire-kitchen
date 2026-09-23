import { motion } from "framer-motion";
import { Link } from "react-router";
import { PhoneMockup } from "./PhoneMockup";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const headlineWords = ["Your", "morning", "prep", "plan."];
const headlineItalicWords = ["Done", "in", "2", "minutes."];

export function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-20">
      {/* Kitchen photography background */}
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        aria-hidden="true"
        style={{ backgroundImage: "url(/photography/hero-kitchen.webp)" }}
      />
      {/* Scrim: dark on the left for text legibility, fading toward the photo's detail on the right */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "linear-gradient(90deg, var(--color-cocoa) 0%, rgba(23,15,10,0.92) 30%, rgba(23,15,10,0.55) 55%, rgba(23,15,10,0.15) 75%, transparent 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "linear-gradient(180deg, rgba(23,15,10,0.35) 0%, transparent 20%, transparent 75%, rgba(23,15,10,0.5) 100%)",
        }}
      />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative z-10 mx-auto grid w-full max-w-7xl items-center gap-12"
        style={{
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        {/* ── Left column: copy ── */}
        <div className="flex flex-col gap-6 max-[900px]:order-1 max-[900px]:items-center max-[900px]:text-center">
          {/* Eyebrow pill */}
          <motion.div variants={fadeUp}>
            <span className="inline-flex items-center gap-2 rounded-full border border-border-copper bg-copper-dim px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-copper">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-copper" />
              AI-Powered Kitchen Operations
            </span>
          </motion.div>

          {/* H1 */}
          <motion.h1
            variants={fadeUp}
            className="font-display font-semibold leading-[1.1] text-white"
            style={{ fontSize: "clamp(2.8rem, 5vw, 4.5rem)" }}
          >
            <span className="flex flex-wrap gap-x-[0.3em] max-[900px]:justify-center">
              {headlineWords.map((word, i) => (
                <motion.span
                  key={word}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.08, duration: 0.45, ease: "easeOut" }}
                >
                  {word}
                </motion.span>
              ))}
            </span>
            <span className="flex flex-wrap gap-x-[0.3em] max-[900px]:justify-center">
              {headlineItalicWords.map((word, i) => (
                <motion.span
                  key={word}
                  className="italic text-copper"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.08, duration: 0.45, ease: "easeOut" }}
                >
                  {word}
                </motion.span>
              ))}
            </span>
          </motion.h1>

          {/* Subtext */}
          <motion.p
            variants={fadeUp}
            className="font-landing max-w-[480px] text-base leading-relaxed text-cocoa-600"
          >
            Tell CulinAIre Kitchen what's on today's menu. Get a prioritised
            task list, cross-usage analysis, and your high-impact dishes
            flagged&nbsp;&mdash; before service starts.
          </motion.p>

          {/* CTA group */}
          <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-4">
            <Link
              to="/register"
              className="inline-flex items-center rounded-lg bg-copper px-8 py-3 text-sm font-semibold text-cocoa transition-all duration-200 hover:-translate-y-0.5 hover:bg-copper-hover hover:shadow-[0_8px_24px_var(--color-border-copper)]"
            >
              Start free trial
            </Link>
            <button
              type="button"
              className="inline-flex items-center gap-2.5 rounded-lg border border-cocoa-200 px-6 py-3 text-sm font-medium text-cocoa-600 transition-all duration-200 hover:border-copper hover:text-copper"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-cocoa-300">
                <svg width="10" height="12" viewBox="0 0 10 12" fill="none" className="ml-0.5">
                  <path d="M1 1L9 6L1 11V1Z" fill="currentColor" />
                </svg>
              </span>
              Watch demo
            </button>
          </motion.div>
        </div>

        {/* ── Right column: phone mockup ── */}
        <div className="flex items-center justify-center max-[900px]:-order-1">
          <PhoneMockup />
        </div>
      </motion.div>

      {/* Responsive: single column on mobile */}
      <style>{`
        @media (max-width: 900px) {
          .min-h-screen { padding-top: 6rem; }
          [style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
