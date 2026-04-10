import { motion } from "framer-motion";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.4, ease: "easeOut" as const },
  },
};

const checkVariants = {
  hidden: { scale: 0, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 15,
      delay: 0.2,
    },
  },
};

interface ReceiveItem {
  name: string;
  ordered: string;
  received: string;
  status: "ok" | "warn";
}

const items: ReceiveItem[] = [
  { name: "Beef tenderloin", ordered: "8kg", received: "8kg", status: "ok" },
  { name: "Atlantic salmon", ordered: "5kg", received: "3kg", status: "warn" },
  { name: "Double cream", ordered: "4L", received: "4L", status: "ok" },
  { name: "Cherry tomatoes", ordered: "2kg", received: "2kg", status: "ok" },
];

export function ReceivingMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      className="w-[300px] rounded-2xl border border-[#2A2A2A] bg-[#161616] p-5 shadow-2xl shadow-black/30"
    >
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-white">
            Receiving Delivery
          </h3>
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            In progress
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[#666666]">
          PO-2024-0847 · Sysco Foods
        </p>
      </div>

      {/* Items */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        {items.map((item, i) => (
          <motion.div
            key={i}
            variants={itemVariants}
            className="flex items-center gap-3 rounded-lg bg-[#1E1E1E] px-3 py-2.5"
          >
            {/* Item info */}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white">{item.name}</p>
              <p className="mt-0.5 text-[10px] text-[#666666]">
                Ordered: {item.ordered} · Received:{" "}
                <span
                  className={
                    item.status === "warn" ? "text-amber-400" : "text-[#666666]"
                  }
                >
                  {item.received}
                </span>
              </p>
            </div>

            {/* Status icon */}
            <motion.div variants={checkVariants}>
              {item.status === "ok" ? (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15">
                  <svg
                    className="h-3.5 w-3.5 text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15">
                  <span className="text-xs font-bold text-amber-400">!</span>
                </div>
              )}
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      {/* Confirm button */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.4 }}
        className="mt-4 w-full rounded-lg bg-gradient-to-r from-[#D4A574] to-[#C4956A] py-2.5 text-xs font-semibold text-[#0A0A0A] shadow-lg shadow-[#D4A574]/20 transition-all hover:shadow-[#D4A574]/30"
      >
        Confirm receipt
      </motion.button>
    </motion.div>
  );
}
