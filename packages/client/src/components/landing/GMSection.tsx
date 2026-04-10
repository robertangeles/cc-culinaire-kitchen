import { useRef } from "react";
import { motion, useInView, useSpring, useTransform } from "framer-motion";

interface Stat {
  prefix: string;
  value: number;
  suffix: string;
  displayOverride?: string;
  label: string;
}

const stats: Stat[] = [
  {
    prefix: "$",
    value: 3.23,
    suffix: "",
    label: "Per day. Less than a kitchen coffee.",
  },
  {
    prefix: "",
    value: 28,
    suffix: " min",
    label: "Saved on prep planning. Every single morning.",
  },
  {
    prefix: "",
    value: 0,
    suffix: "",
    displayOverride: "Zero",
    label: "End-of-service leftovers without a reuse plan.",
  },
];

function AnimatedStat({ stat }: { stat: Stat }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });

  const spring = useSpring(0, { stiffness: 50, damping: 18 });
  const display = useTransform(spring, (v) => {
    if (stat.displayOverride && v === 0) return stat.displayOverride;
    if (stat.prefix === "$") return `${stat.prefix}${v.toFixed(2)}`;
    return `${stat.prefix}${Math.round(v)}${stat.suffix}`;
  });

  if (isInView && !stat.displayOverride) {
    spring.set(stat.value);
  }

  return (
    <div ref={ref} className="border-l-2 border-gold pl-5">
      <motion.span className="font-display text-3xl text-white">
        {stat.displayOverride ? stat.displayOverride : display}
      </motion.span>
      <p className="mt-1 text-sm text-dark-500">{stat.label}</p>
    </div>
  );
}

export function GMSection() {
  return (
    <section
      className="border-t border-border-gold px-8 py-20"
      style={{
        background:
          "linear-gradient(to bottom right, var(--color-gold-glow, rgba(212,165,116,0.06)), transparent)",
      }}
    >
      <div className="mx-auto max-w-3xl text-center">
        {/* Label pill */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          viewport={{ once: true }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-border-gold bg-gold-dim px-5 py-2 text-sm text-gold"
        >
          <span aria-hidden="true">{"\u{1F4CA}"}</span>
          Showing this to your owner or manager?
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          viewport={{ once: true }}
          className="font-display font-semibold text-white"
          style={{ fontSize: "clamp(1.8rem, 3vw, 2.6rem)" }}
        >
          The numbers that justify the $97.
        </motion.h2>

        {/* Stats grid */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
          viewport={{ once: true }}
          className="mx-auto mt-12 grid max-w-2xl gap-8 text-left sm:grid-cols-3"
        >
          {stats.map((stat) => (
            <AnimatedStat key={stat.label} stat={stat} />
          ))}
        </motion.div>

        {/* Closing line */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}
          viewport={{ once: true }}
          className="mx-auto mt-14 max-w-xl font-display text-base italic leading-relaxed text-dark-600"
        >
          If your kitchen runs tighter, wastes less, and your chef spends more
          time cooking&nbsp;&mdash; that is the return. One prevented stock-out
          pays for six months.
        </motion.p>
      </div>
    </section>
  );
}
