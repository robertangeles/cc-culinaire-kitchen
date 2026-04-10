import { motion } from "framer-motion";
import { Link } from "react-router";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-dark-200 py-28 text-center">
      {/* Radial gold glow */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(212,165,116,0.07) 0%, transparent 70%)",
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
          <span className="italic text-gold">a crumpled ticket.</span>
        </h2>

        <p className="mx-auto mt-6 max-w-md font-landing text-base leading-relaxed text-dark-600">
          Start your free trial. See what 2-minute prep planning feels like.
        </p>

        <div className="mt-10">
          <Link
            to="/register"
            className="inline-flex items-center rounded-lg bg-gold px-10 py-4 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover"
            style={{
              boxShadow:
                "0 0 24px rgba(212,165,116,0.2), 0 0 48px rgba(212,165,116,0.1)",
            }}
          >
            Start your 3-day free trial&nbsp;&mdash; no credit card needed
          </Link>
        </div>

        {/* Animated glow pulse */}
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full"
          animate={{
            boxShadow: [
              "0 0 60px rgba(212,165,116,0.06)",
              "0 0 100px rgba(212,165,116,0.12)",
              "0 0 60px rgba(212,165,116,0.06)",
            ],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden="true"
        />
      </motion.div>
    </section>
  );
}
