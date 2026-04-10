import { motion } from "framer-motion";

interface Feature {
  icon: string;
  name: string;
  description: string;
}

interface FeatureGroup {
  label: string;
  features: Feature[];
}

const groups: FeatureGroup[] = [
  {
    label: "Know your kitchen",
    features: [
      {
        icon: "\u{1F9D1}\u200D\u{1F373}",
        name: "AI Culinary Assistant",
        description:
          "Ask it anything mid-service. Techniques, substitutions, troubleshooting. It understands culinary science \u2014 not SEO articles.",
      },
      {
        icon: "\u{1F37D}\uFE0F",
        name: "Recipe Lab",
        description:
          "Build recipes around what\u2019s already on your shelf. Generate, refine, cost, and export \u2014 with full portion scaling.",
      },
      {
        icon: "\u{1F950}",
        name: "Patisserie Lab",
        description:
          "Precision pastry intelligence. Ratios, hydration, fermentation, tempering. What generic AI gets wrong, this gets right.",
      },
      {
        icon: "\u{1F378}",
        name: "Spirits Lab",
        description:
          "Cocktail structures, flavour pairing, and spirits fundamentals for restaurants with serious beverage programs.",
      },
    ],
  },
  {
    label: "Run your kitchen",
    features: [
      {
        icon: "\u{1F4CB}",
        name: "Kitchen Copilot",
        description:
          "Plan today\u2019s prep before you touch a knife. Prioritised tasks, cross-usage analysis, high-impact dishes flagged first.",
      },
      {
        icon: "\u{1F4E6}",
        name: "Stock Room",
        description:
          "Real-time inventory with FIFO batch management. Par levels, parallel stock takes, cross-location transfers, and AI depletion forecasting.",
      },
      {
        icon: "\u{1F6D2}",
        name: "Purchasing",
        description:
          "Draft POs from par-level suggestions. Mobile receiving in 90 seconds. Discrepancy logging that protects your margins.",
      },
      {
        icon: "\u{1F4CA}",
        name: "Menu Intelligence",
        description:
          "See which dishes make you money and which ones don\u2019t. Stars, Puzzles, Workhorses, Dogs \u2014 know your menu mix.",
      },
      {
        icon: "\u267B\uFE0F",
        name: "Waste Intelligence",
        description:
          "End-of-service leftovers get a plan, not a bin. Log waste, see the cost impact, get AI-powered reuse ideas.",
      },
    ],
  },
  {
    label: "Grow your kitchen",
    features: [
      {
        icon: "\u{1F4AC}",
        name: "The Bench",
        description:
          "Your kitchen team in one channel. Share recipes as interactive cards. See who\u2019s on the pass with live presence.",
      },
      {
        icon: "\u{1F4DA}",
        name: "Kitchen Shelf",
        description:
          "Public recipe gallery. Share your recipes, browse what other chefs are creating. A professional community, not a social feed.",
      },
    ],
  },
];

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

export function FeatureShowcase() {
  return (
    <section id="features" className="border-t border-dark-200 bg-dark-50 px-8 py-24">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <span className="mb-3 inline-block text-xs font-semibold uppercase tracking-widest text-gold">
            Everything your kitchen needs
          </span>
          <h2
            className="font-display font-semibold text-white"
            style={{ fontSize: "clamp(2rem, 3.5vw, 3rem)" }}
          >
            One platform. Every tool.
          </h2>
        </div>

        {/* Feature groups */}
        <div className="flex flex-col gap-16">
          {groups.map((group) => (
            <div key={group.label}>
              {/* Group label with rule */}
              <div className="mb-8 flex items-center gap-4">
                <span className="whitespace-nowrap text-sm font-semibold text-gold">
                  {group.label}
                </span>
                <div className="h-px flex-1 bg-dark-200" />
              </div>

              {/* Card grid */}
              <motion.div
                variants={containerVariants}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-40px" }}
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {group.features.map((feature) => (
                  <motion.div
                    key={feature.name}
                    variants={cardVariants}
                    whileHover={{
                      y: -3,
                      borderColor: "rgba(212,165,116,0.25)",
                    }}
                    className="rounded-xl border border-dark-200 bg-dark-100 p-6 transition-shadow duration-200 hover:shadow-[0_0_20px_rgba(212,165,116,0.06)]"
                  >
                    <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-gold-dim text-lg">
                      {feature.icon}
                    </div>
                    <h3 className="mb-2 text-sm font-bold text-white">
                      {feature.name}
                    </h3>
                    <p className="text-sm leading-relaxed text-dark-500">
                      {feature.description}
                    </p>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
