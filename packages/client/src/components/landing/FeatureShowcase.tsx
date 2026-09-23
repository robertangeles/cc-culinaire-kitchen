import { motion } from "framer-motion";
import {
  ChefHat,
  UtensilsCrossed,
  Croissant,
  Martini,
  ClipboardList,
  Package,
  ShoppingCart,
  BarChart3,
  Recycle,
  MessageSquare,
  Library,
  type LucideIcon,
} from "lucide-react";

interface Feature {
  icon: LucideIcon;
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
        icon: ChefHat,
        name: "AI Culinary Assistant",
        description:
          "Ask it anything mid-service. Techniques, substitutions, troubleshooting. It understands culinary science \u2014 not SEO articles.",
      },
      {
        icon: UtensilsCrossed,
        name: "Recipe Lab",
        description:
          "Build recipes around what\u2019s already on your shelf. Generate, refine, cost, and export \u2014 with full portion scaling.",
      },
      {
        icon: Croissant,
        name: "Pastry Lab",
        description:
          "Precision pastry intelligence. Ratios, hydration, fermentation, tempering. What generic AI gets wrong, this gets right.",
      },
      {
        icon: Martini,
        name: "Cocktail Lab",
        description:
          "Cocktail structures, flavour pairing, and spirits fundamentals for restaurants with serious beverage programs.",
      },
    ],
  },
  {
    label: "Run your kitchen",
    features: [
      {
        icon: ClipboardList,
        name: "Prep",
        description:
          "Plan today\u2019s prep before you touch a knife. Prioritised tasks, cross-usage analysis, high-impact dishes flagged first.",
      },
      {
        icon: Package,
        name: "Inventory",
        description:
          "Real-time inventory with FIFO batch management. Par levels, parallel stock takes, cross-location transfers, and AI depletion forecasting.",
      },
      {
        icon: ShoppingCart,
        name: "Ordering",
        description:
          "Draft POs from par-level suggestions. Mobile receiving in 90 seconds. Discrepancy logging that protects your margins.",
      },
      {
        icon: BarChart3,
        name: "Menu & Costing",
        description:
          "See which dishes make you money and which ones don\u2019t. Stars, Puzzles, Workhorses, Dogs \u2014 know your menu mix.",
      },
      {
        icon: Recycle,
        name: "Waste",
        description:
          "End-of-service leftovers get a plan, not a bin. Log waste, see the cost impact, get AI-powered reuse ideas.",
      },
    ],
  },
  {
    label: "Grow your kitchen",
    features: [
      {
        icon: MessageSquare,
        name: "The Bench",
        description:
          "Your kitchen team in one channel. Share recipes as interactive cards. See who\u2019s on the pass with live presence.",
      },
      {
        icon: Library,
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
    <section id="features" className="border-t border-cocoa-200 bg-cocoa-50 px-8 py-24">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-16 text-center">
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
                <span className="whitespace-nowrap text-sm font-semibold text-copper">
                  {group.label}
                </span>
                <div className="h-px flex-1 bg-cocoa-200" />
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
                      borderColor: "var(--color-border-copper)",
                    }}
                    className="rounded-xl border border-cocoa-200 bg-cocoa-100 p-6 transition-shadow duration-200 hover:shadow-[0_0_20px_rgba(198,117,58,0.06)]"
                  >
                    <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg bg-copper-dim">
                      <feature.icon className="h-4.5 w-4.5 text-copper" strokeWidth={1.75} />
                    </div>
                    <h3 className="mb-2 text-sm font-bold text-white">
                      {feature.name}
                    </h3>
                    <p className="text-sm leading-relaxed text-cocoa-500">
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
