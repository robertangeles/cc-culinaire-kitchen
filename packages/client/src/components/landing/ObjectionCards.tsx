import { motion } from "framer-motion";

interface Card {
  number: string;
  headline: string;
  body: string;
}

const cards: Card[] = [
  {
    number: "01",
    headline: "It knows your mirepoix covers four dishes.",
    body: "It tells you to prep once \u2014 not four times.",
  },
  {
    number: "02",
    headline: "It knows tonight\u2019s special puts pressure on your protein prep.",
    body: "It flags it first \u2014 before you start the wrong thing.",
  },
  {
    number: "03",
    headline: "It learned from real culinary technique",
    body: "\u2014 not food blogs. Ask it about emulsions. Tempering chocolate. Sauce reductions. It keeps up.",
  },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const cardVariant = {
  hidden: { opacity: 0, x: -20, scale: 0.97 },
  show: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: { duration: 0.45, ease: "easeOut" as const },
  },
};

export function ObjectionCards() {
  return (
    <section className="border-y border-dark-200 bg-dark-50 px-8 py-20">
      <div className="mx-auto max-w-7xl">
        {/* Eyebrow */}
        <p className="text-xs font-semibold uppercase tracking-widest text-gold">
          Built different
        </p>

        {/* H2 */}
        <h2
          className="font-display mt-4 font-semibold leading-tight text-white"
          style={{ fontSize: "clamp(1.8rem, 3.5vw, 3rem)" }}
        >
          You've seen AI get cooking wrong.
          <br />
          Here's what's different.
        </h2>

        {/* Cards grid */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-12 grid gap-6 md:grid-cols-3"
        >
          {cards.map((card) => (
            <motion.div
              key={card.number}
              variants={cardVariant}
              className="group rounded-xl border border-dark-200 border-l-[3px] border-l-gold bg-dark-100 p-7 transition-all duration-200 hover:-translate-y-[3px] hover:border-border-gold"
            >
              <span
                className="font-display block text-5xl font-bold leading-none text-gold/15"
                aria-hidden="true"
              >
                {card.number}
              </span>
              <p className="mt-4 text-base font-semibold leading-snug text-white">
                {card.headline}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-dark-600">
                {card.body}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
