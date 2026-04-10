import { motion } from "framer-motion";
import { LocationMap } from "./LocationMap";

const bullets = [
  "Cross-location stock visibility \u2014 see surplus at one site, shortage at another, transfer instantly",
  "Spend threshold controls \u2014 small orders go direct, large spend routes through HQ approval",
  "Location classifications \u2014 HQ, Branch, Commissary, Satellite \u2014 each with the right permissions",
  "Centrally managed supplier catalogue with location-level activation",
  "HQ can view, flag, or reject any location\u2019s stock take in real time",
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" as const } },
};

export function MultiLocation() {
  return (
    <section className="border-y border-dark-200 bg-dark-50 px-8 py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
        {/* Left column */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="flex flex-col gap-6"
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-gold">
            Multi-location
          </span>

          <h2
            className="font-display font-semibold leading-tight text-white"
            style={{ fontSize: "clamp(1.8rem, 3vw, 2.6rem)" }}
          >
            One platform for every kitchen in your group.
          </h2>

          <p className="font-landing max-w-lg leading-relaxed text-dark-600">
            HQ sees everything. Every location moves at its own speed. Inventory,
            purchasing, prep, and waste tracked across your entire
            operation&nbsp;&mdash; from one dashboard.
          </p>

          <ul className="flex flex-col gap-3">
            {bullets.map((text) => (
              <li key={text} className="flex items-start gap-3 text-sm leading-relaxed text-dark-500">
                <span className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gold" />
                {text}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Right column */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="flex items-center justify-center"
        >
          <LocationMap />
        </motion.div>
      </div>
    </section>
  );
}
