import { useRef } from "react";
import { motion, useInView, useSpring, useTransform } from "framer-motion";
import { ReceivingMockup } from "./ReceivingMockup";

interface Metric {
  value: number;
  suffix: string;
  label: string;
}

const metrics: Metric[] = [
  { value: 90, suffix: "s", label: "To receive a full delivery" },
  { value: 2, suffix: "m", label: "To plan your entire prep session" },
  { value: 30, suffix: "s", label: "To log a waste event" },
  { value: 3, suffix: " taps", label: "To raise a purchase order" },
];

function AnimatedCounter({ value, suffix }: { value: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });

  const spring = useSpring(0, { stiffness: 60, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v));

  if (isInView) {
    spring.set(value);
  }

  return (
    <span ref={ref} className="font-display text-3xl text-gold">
      <motion.span>{display}</motion.span>
      {suffix}
    </span>
  );
}

export function MobileCallout() {
  return (
    <section className="mx-auto max-w-7xl px-8 py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        {/* Left column: copy */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          viewport={{ once: true, margin: "-60px" }}
          className="flex flex-col gap-6"
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-gold">
            Mobile first
          </span>

          <h2
            className="font-display font-semibold leading-tight text-white"
            style={{ fontSize: "clamp(1.8rem, 3vw, 2.6rem)" }}
          >
            Works at the back dock, the walk-in, and the pass.
          </h2>

          <p className="font-landing max-w-lg leading-relaxed text-dark-600">
            Chefs don&rsquo;t work at desks. CulinAIre Kitchen is built for the
            phone in your pocket&nbsp;&mdash; one thumb, three taps, delivery
            received.
          </p>

          {/* Metric cards */}
          <div className="grid grid-cols-2 gap-3">
            {metrics.map((m) => (
              <div
                key={m.label}
                className="rounded-xl border border-dark-200 bg-dark-50 p-5"
              >
                <AnimatedCounter value={m.value} suffix={m.suffix} />
                <p className="mt-1 text-sm text-dark-500">{m.label}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Right column: mockup */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
          viewport={{ once: true, margin: "-60px" }}
          className="flex items-center justify-center"
        >
          <ReceivingMockup />
        </motion.div>
      </div>
    </section>
  );
}
