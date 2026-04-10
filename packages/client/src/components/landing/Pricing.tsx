import { motion } from "framer-motion";
import { Link } from "react-router";

const features = [
  "AI Culinary Assistant \u2014 unlimited",
  "Kitchen Copilot \u2014 daily prep planning",
  "Recipe Lab, Patisserie Lab & Spirits Lab",
  "Stock Room \u2014 full inventory management",
  "Purchasing & mobile delivery receiving",
  "Menu Intelligence & Waste Intelligence",
  "The Bench community & Kitchen Shelf",
  "Multi-location support & HQ dashboard",
];

interface CompRow {
  platform: string;
  cost: string;
  allInOne: string;
  highlight?: boolean;
}

const comparisons: CompRow[] = [
  {
    platform: "CulinAIre Kitchen",
    cost: "$97/mo",
    allInOne: "Yes",
    highlight: true,
  },
  { platform: "ChefTec", cost: "$200+/mo", allInOne: "Inventory only" },
  { platform: "MarketMan", cost: "$239/mo", allInOne: "Inventory + PO" },
  { platform: "BlueCart", cost: "$149/mo", allInOne: "Ordering only" },
  {
    platform: "5 separate tools",
    cost: "$400\u2013600/mo",
    allInOne: "Never integrated",
  },
];

const rowStagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const rowFade = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { duration: 0.35, ease: "easeOut" as const } },
};

function CheckIcon() {
  return (
    <svg
      className="h-5 w-5 flex-shrink-0 text-emerald-400"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-8 py-24">
      {/* Header */}
      <div className="mb-16 text-center">
        <span className="mb-3 inline-block text-xs font-semibold uppercase tracking-widest text-gold">
          Pricing
        </span>
        <h2
          className="font-display font-semibold text-white"
          style={{ fontSize: "clamp(2rem, 3.5vw, 3rem)" }}
        >
          Simple pricing. No surprises.
        </h2>
      </div>

      <div className="grid items-start gap-10 lg:grid-cols-2">
        {/* ── Left: Pricing card ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          viewport={{ once: true }}
          className="relative overflow-hidden rounded-2xl border border-border-gold bg-dark-50 p-10"
        >
          {/* Gold gradient line at top */}
          <div
            className="absolute inset-x-0 top-0 h-0.5"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--color-gold, #D4A574), transparent)",
            }}
          />

          {/* Price */}
          <div className="mb-6">
            <span className="font-display text-6xl font-semibold text-white">
              $97
            </span>
            <span className="ml-2 text-sm text-dark-500">
              per chef / per month &middot; USD
            </span>
          </div>

          {/* CTA */}
          <Link
            to="/register"
            className="mb-3 block w-full rounded-lg bg-gold py-3.5 text-center text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover hover:shadow-[0_8px_24px_rgba(212,165,116,0.25)]"
          >
            Start your 3-day free trial
          </Link>
          <p className="mb-8 text-center text-xs text-dark-500">
            No credit card required &middot; Cancel anytime
          </p>

          {/* Divider */}
          <div className="mb-8 h-px bg-dark-200" />

          {/* Feature checklist */}
          <ul className="flex flex-col gap-3">
            {features.map((f) => (
              <li key={f} className="flex items-center gap-3 text-sm text-dark-500">
                <CheckIcon />
                {f}
              </li>
            ))}
          </ul>

          {/* Team note */}
          <p className="mt-8 text-sm text-dark-500">
            Running multiple kitchens?{" "}
            <Link
              to="/contact"
              className="text-gold transition-colors hover:text-gold-hover"
            >
              Contact us for team pricing &rarr;
            </Link>
          </p>

          {/* Glow pulse on reveal */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 1.5 }}
            viewport={{ once: true }}
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{
              boxShadow: "0 0 40px rgba(212,165,116,0.08)",
            }}
          />
        </motion.div>

        {/* ── Right: Comparison ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
          viewport={{ once: true }}
        >
          <h3 className="mb-3 font-display text-xl font-semibold text-white">
            Less than the alternatives. More than any of them.
          </h3>
          <p className="mb-8 text-sm leading-relaxed text-dark-600">
            CulinAIre Kitchen replaces up to 5 separate tools&nbsp;&mdash; at a
            fraction of the combined cost.
          </p>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-dark-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-dark-200 text-xs uppercase tracking-wider text-dark-500">
                  <th className="px-5 py-3 font-semibold">Platform</th>
                  <th className="px-5 py-3 font-semibold">Monthly cost</th>
                  <th className="px-5 py-3 font-semibold">All-in-one?</th>
                </tr>
              </thead>
              <motion.tbody
                variants={rowStagger}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-40px" }}
              >
                {comparisons.map((row) => (
                  <motion.tr
                    key={row.platform}
                    variants={rowFade}
                    className={
                      row.highlight
                        ? "bg-gold-dim shadow-[0_0_20px_rgba(212,165,116,0.06)]"
                        : "border-b border-dark-200 last:border-0"
                    }
                  >
                    <td className="px-5 py-3.5 font-medium text-white">
                      {row.platform}
                      {row.highlight && (
                        <span className="ml-2 rounded-full border border-border-gold bg-gold-dim px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
                          You&rsquo;re here
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-5 py-3.5 ${row.highlight ? "font-semibold text-gold" : "text-dark-500"}`}
                    >
                      {row.cost}
                    </td>
                    <td
                      className={`px-5 py-3.5 ${row.highlight ? "font-semibold text-gold" : "text-dark-500"}`}
                    >
                      {row.allInOne}
                    </td>
                  </motion.tr>
                ))}
              </motion.tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
