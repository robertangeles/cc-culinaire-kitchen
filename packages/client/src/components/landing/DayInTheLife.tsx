import { motion } from "framer-motion";

interface TimelineEntry {
  time: string;
  module: string;
  description: string;
}

const timeline: TimelineEntry[] = [
  {
    time: "6 am",
    module: "Stock Room",
    description:
      "Check stock levels. <b>AI flags 3 items below par</b> \u2014 salmon, double cream, and pine nuts. Draft PO generated. One tap to approve and send to supplier.",
  },
  {
    time: "8 am",
    module: "Purchasing \u2014 Receiving",
    description:
      "Delivery arrives at the back dock. <b>Open the PO on your phone. Tap through line by line.</b> Salmon short by 2kg \u2014 logged in 4 seconds. Confirm receipt. Inventory updated. Done.",
  },
  {
    time: "10 am",
    module: "Kitchen Copilot",
    description:
      "<b>Prioritised task list for today\u2019s service.</b> Mirepoix flagged as cross-use across 4 dishes \u2014 prep once. Beef stock needs to start now for a 4-hour simmer. No guessing. No crumpled ticket.",
  },
  {
    time: "2 pm",
    module: "Menu Intelligence",
    description:
      "Quick menu review before the dinner rush. <b>Pork Belly: Star dish \u2014 high margin, high popularity.</b> Duck Confit: Puzzle \u2014 good margin but slow moving. Time to promote or rethink.",
  },
  {
    time: "4 pm",
    module: "AI Culinary Assistant",
    description:
      "New sauce isn\u2019t emulsifying right before service. <b>Type it in. Get a fix in seconds</b> \u2014 from an AI that understands culinary science, not a food blog SEO article.",
  },
  {
    time: "10 pm",
    module: "Waste Intelligence",
    description:
      "End of service. 4kg of carrot trim, 2kg of duck confit leftover. <b>Log the waste. AI surfaces 3 reuse ideas for tomorrow.</b> Nothing goes in the bin without a plan first.",
  },
];

const itemVariant = {
  hidden: { opacity: 0, x: -30 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.5, ease: "easeOut" as const },
  },
};

const dotVariant = {
  hidden: { scale: 0 },
  show: {
    scale: 1,
    transition: { type: "spring" as const, stiffness: 400, damping: 15 },
  },
};

export function DayInTheLife() {
  return (
    <section className="mx-auto max-w-7xl px-8 py-24">
      {/* Eyebrow */}
      <p className="text-xs font-semibold uppercase tracking-widest text-gold">
        A day with CulinAIre
      </p>

      {/* H2 */}
      <h2
        className="font-display mt-4 font-semibold leading-tight text-white"
        style={{ fontSize: "clamp(1.8rem, 3.5vw, 3rem)" }}
      >
        From the back dock to the pass.
      </h2>

      {/* Timeline */}
      <div className="relative mt-16">
        {/* Vertical connecting line */}
        <div
          className="pointer-events-none absolute left-[127px] top-0 bottom-0 hidden w-px md:block"
          style={{
            background:
              "linear-gradient(to bottom, transparent 0%, #2A2A2A 10%, #2A2A2A 90%, transparent 100%)",
          }}
        />

        <div className="flex flex-col gap-10">
          {timeline.map((item, i) => (
            <motion.div
              key={item.time}
              variants={itemVariant}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.06 }}
              className="grid items-start gap-6 md:grid-cols-[120px_24px_1fr]"
            >
              {/* Time label */}
              <div className="flex items-center justify-end gap-3 md:pt-1">
                <span className="font-display text-lg font-semibold text-gold">
                  {item.time}
                </span>
              </div>

              {/* Gold dot */}
              <div className="hidden items-start justify-center pt-2 md:flex">
                <motion.div
                  variants={dotVariant}
                  className="h-3 w-3 rounded-full border-2 border-gold bg-dark"
                  style={{ boxShadow: "0 0 12px rgba(212,165,116,0.3)" }}
                />
              </div>

              {/* Content card */}
              <div className="rounded-xl border border-dark-200 bg-dark-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-gold">
                  {item.module}
                </p>
                <p
                  className="mt-2 text-sm leading-relaxed text-dark-600 [&>b]:font-semibold [&>b]:text-white"
                  dangerouslySetInnerHTML={{ __html: item.description }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
