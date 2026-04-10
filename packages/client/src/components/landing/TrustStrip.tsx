import { motion } from "framer-motion";

const kitchenTypes = [
  "Fine dining kitchens",
  "Casual dining groups",
  "Hotel kitchens",
  "Multi-site restaurant groups",
  "Commissary kitchens",
  "Catering operations",
] as const;

export function TrustStrip() {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      viewport={{ once: true, margin: "-40px" }}
      className="border-y border-dark-200 bg-dark-50 py-5"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6">
        {kitchenTypes.map((label) => (
          <span key={label} className="flex items-center gap-2 text-sm text-dark-500">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            {label}
          </span>
        ))}
      </div>
    </motion.section>
  );
}
