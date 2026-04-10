import { motion } from "framer-motion";

export function ProblemStatement() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
      viewport={{ once: true, margin: "-60px" }}
      className="mx-auto max-w-3xl px-6 py-24 text-center"
    >
      <p
        className="font-display font-light italic leading-relaxed text-dark-600"
        style={{ fontSize: "clamp(1.4rem, 2.5vw, 2rem)" }}
      >
        Every morning, the prep plan lives{" "}
        <em className="not-italic font-normal text-white">in your head</em>.
        What needs to go first. Which components cross over. What to nail
        before the rush hits. You piece it together from memory, from
        experience, from instinct.
      </p>

      <p
        className="mt-8 font-display font-light italic leading-relaxed text-dark-600"
        style={{ fontSize: "clamp(1.4rem, 2.5vw, 2rem)" }}
      >
        <em className="not-italic font-normal text-white">
          CulinAIre Kitchen does that in two minutes
        </em>{" "}
        &mdash; so you can spend the rest of the morning actually cooking.
      </p>
    </motion.section>
  );
}
