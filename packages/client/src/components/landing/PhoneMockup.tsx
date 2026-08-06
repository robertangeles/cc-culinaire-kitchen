import { motion } from "framer-motion";

export function PhoneMockup() {
  const prepItems = [
    {
      title: "Beef stock reduction",
      detail: "Start now — 4hr simmer required",
      borderColor: "border-l-gold",
      badge: null,
    },
    {
      title: "Mirepoix base",
      detail: "Covers 4 dishes — prep once",
      borderColor: "border-l-emerald-500",
      badge: "Cross-use: Risotto, Braise, Soup, Sauce",
    },
    {
      title: "Pastry shells",
      detail: "12 portions — bake at 10am",
      borderColor: "border-l-dark-200",
      badge: null,
    },
    {
      title: "Protein butchery",
      detail: "Salmon: 18 covers · Beef: 24 covers",
      borderColor: "border-l-dark-200",
      badge: null,
    },
  ];

  return (
    <div className="relative flex items-center justify-center">
      {/* Floating card — left: Low stock alert */}
      <div
        className="absolute -left-4 top-16 z-20 w-48 rounded-xl border border-amber-500/20 bg-dark-50/90 p-3 shadow-lg shadow-amber-900/10 backdrop-blur-md"
        style={{ animation: "float 4s ease-in-out infinite" }}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            Low stock alert
          </span>
        </div>
        <p className="text-xs text-dark-600">Salmon — 2kg remaining</p>
      </div>

      {/* Floating card — right: AI suggestion */}
      <div
        className="absolute -right-4 bottom-24 z-20 w-48 rounded-xl border border-gold/20 bg-dark-50/90 p-3 shadow-lg shadow-gold/10 backdrop-blur-md"
        style={{ animation: "float 4s ease-in-out infinite 2s" }}
      >
        <div className="mb-1 flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-gold" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gold">
            AI suggestion
          </span>
        </div>
        <p className="text-xs text-dark-600">
          Use carrot trim in tomorrow's stock
        </p>
      </div>

      {/* Phone frame */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 w-[280px] rounded-[28px] border border-dark-200 bg-dark-50 p-3 shadow-2xl shadow-black/40"
      >
        {/* Notch */}
        <div className="mx-auto mb-3 h-5 w-24 rounded-b-xl bg-dark" />

        {/* App content */}
        <div className="space-y-3 px-2 pb-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-white">
              Prep
            </h3>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Live
            </span>
          </div>

          <p className="text-[11px] text-dark-600">
            Today's prep plan — Friday service
          </p>

          {/* Prep items */}
          <div className="space-y-2">
            {prepItems.map((item, i) => (
              <div
                key={i}
                className={`rounded-lg border-l-2 ${item.borderColor} bg-dark-100 px-3 py-2`}
              >
                <p className="text-xs font-medium text-white">{item.title}</p>
                <p className="mt-0.5 text-[10px] text-dark-500">
                  {item.detail}
                </p>
                {item.badge && (
                  <span className="mt-1 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] text-emerald-400">
                    {item.badge}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="h-px bg-dark-200" />

          {/* Stats row */}
          <div className="flex items-center justify-between text-center">
            {[
              { value: "4", label: "Tasks" },
              { value: "2m", label: "To plan" },
              { value: "28m", label: "Saved" },
            ].map((stat, i) => (
              <div key={i}>
                <p className="text-sm font-semibold text-gold">
                  {stat.value}
                </p>
                <p className="text-[9px] text-dark-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
