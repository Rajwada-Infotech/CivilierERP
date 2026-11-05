// How the sign-in page moves: soft springs that overshoot a little, and the parts arriving one after another.
import type { Transition, Variants } from "framer-motion";

/** A bouncy settle: overshoots once, then rests. */
export const BOUNCE: Transition = { type: "spring", stiffness: 260, damping: 15, mass: 0.9 };
/** A softer, flowing settle for the larger pieces. */
export const FLOW: Transition = { type: "spring", stiffness: 120, damping: 18, mass: 1 };

/** A parent whose children arrive one after another. */
export const cascade = (delayChildren = 0, staggerChildren = 0.07): Variants => ({
  hidden: {},
  show: { transition: { delayChildren, staggerChildren } },
});

/** A child that hops up into place. */
export const hop: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: BOUNCE },
};

/** A child that pops in from small. */
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.6, y: 10 },
  show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 380, damping: 14 } },
};
