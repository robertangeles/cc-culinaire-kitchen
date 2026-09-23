import { motion } from "framer-motion";
import { Link } from "react-router";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-cocoa-200 py-28 text-center">
      {/* Radial copper glow */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(198,117,58,0.07) 0%, transparent 70%)",
        }}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        viewport={{ once: true, margin: "-60px" }}
        className="relative z-10 mx-auto max-w-3xl px-8"
      >
        <h2
          className="font-display font-semibold leading-tight text-white"
          style={{ fontSize: "clamp(2rem, 4vw, 3.4rem)" }}
        >
          Your kitchen deserves better than
          <br />
          <span className="italic text-copper">a crumpled ticket.</span>
        </h2>

        <p className="mx-auto mt-6 max-w-md font-landing text-base leading-relaxed text-cocoa-600">
          Start your free trial. See what 2-minute prep planning feels like.
        </p>

        <div className="mt-10">
          <Link
            to="/register"
            className="inline-flex items-center rounded-lg bg-copper px-10 py-4 text-sm font-semibold text-cocoa transition-all duration-200 hover:-translate-y-0.5 hover:bg-copper-hover"
            style={{
              boxShadow:
                "0 0 24px rgba(198,117,58,0.2), 0 0 48px rgba(198,117,58,0.1)",
            }}
          >
            Start your 3-day free trial&nbsp;&mdash; no credit card needed
          </Link>
        </div>
      </motion.div>
    </section>
  );
}
