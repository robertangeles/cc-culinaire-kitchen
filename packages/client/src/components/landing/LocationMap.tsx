import { motion } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.15 },
  },
};

const nodeVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: "easeOut" as const },
  },
};

interface LocationNode {
  name: string;
  type: string;
  address: string;
  dotColor: string;
  borderColor: string;
  badge: { text: string; color: "green" | "amber" };
  indented: boolean;
}

const locations: LocationNode[] = [
  {
    name: "Comfort Spoon Co. — HQ",
    type: "Headquarters",
    address: "Melbourne CBD",
    dotColor: "bg-[#D4A574]",
    borderColor: "border-[#D4A574]/30",
    badge: { text: "Healthy", color: "green" },
    indented: false,
  },
  {
    name: "Bundoora Store",
    type: "Branch",
    address: "2 Greenwich Crescent",
    dotColor: "bg-emerald-400",
    borderColor: "border-[#2A2A2A]",
    badge: { text: "3 low stock", color: "amber" },
    indented: true,
  },
  {
    name: "Fitzroy Kitchen",
    type: "Branch",
    address: "Smith Street",
    dotColor: "bg-emerald-400",
    borderColor: "border-[#2A2A2A]",
    badge: { text: "Healthy", color: "green" },
    indented: true,
  },
  {
    name: "Central Prep Kitchen",
    type: "Commissary",
    address: "Port Melbourne",
    dotColor: "bg-[#666666]",
    borderColor: "border-[#2A2A2A]",
    badge: { text: "Healthy", color: "green" },
    indented: true,
  },
];

export function LocationMap() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="w-[320px] rounded-2xl border border-[#2A2A2A] bg-[#1E1E1E] p-5 shadow-2xl shadow-black/30"
    >
      {/* Header */}
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#666666]">
        Organisation Overview
      </p>

      {/* Location nodes */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        {locations.map((loc, i) => (
          <motion.div
            key={i}
            variants={nodeVariants}
            className={`relative flex items-center gap-3 rounded-xl border ${loc.borderColor} bg-[#161616] px-3 py-3 ${loc.indented ? "ml-6" : ""}`}
          >
            {/* Connector line for indented items */}
            {loc.indented && (
              <div className="absolute -left-4 top-1/2 h-px w-4 bg-[#2A2A2A]" />
            )}

            {/* Dot */}
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${loc.dotColor} shadow-sm`}
            />

            {/* Info */}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white">{loc.name}</p>
              <p className="mt-0.5 text-[10px] text-[#666666]">
                {loc.type} · {loc.address}
              </p>
            </div>

            {/* Badge */}
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium ${
                loc.badge.color === "green"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-amber-500/10 text-amber-400"
              }`}
            >
              {loc.badge.text}
            </span>
          </motion.div>
        ))}
      </motion.div>

      {/* Vertical connector line behind nodes */}
      <div
        className="pointer-events-none absolute left-[2.85rem] top-[4.5rem] -z-10 hidden h-[calc(100%-6rem)] w-px bg-[#2A2A2A]"
        aria-hidden
      />
    </motion.div>
  );
}
