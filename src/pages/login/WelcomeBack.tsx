// Shown for the moment between a successful sign-in and the dashboard opening: the card hops up and the tick bounces in.
import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { BOUNCE } from "./motion";

export function WelcomeBack({ name }: { name?: string }) {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  return (
    <motion.div
      className="absolute inset-0 z-[60] flex items-center justify-center px-4"
      style={{ background: "rgba(246,246,244,0.8)", backdropFilter: "blur(6px)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      role="status"
    >
      <motion.div
        className="ls-card flex items-center gap-4 pl-5 pr-7 py-5"
        initial={{ y: 40, opacity: 0, scale: 0.85 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -12, opacity: 0, transition: { duration: 0.18 } }}
        transition={BOUNCE}
      >
        <motion.span
          className="w-10 h-10 flex items-center justify-center shrink-0 rounded-full"
          style={{ background: "var(--green)" }}
          initial={{ scale: 0, rotate: -120 }}
          animate={{ scale: [0, 1.25, 1], rotate: 0 }}
          transition={{ duration: 0.6, times: [0, 0.6, 1], ease: "easeOut", delay: 0.15 }}
        >
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="flex">
            <Check size={20} color="#fff" strokeWidth={3} />
          </motion.span>
        </motion.span>
        <div>
          <motion.p className="font-heading font-semibold text-lg tracking-tight" style={{ color: "var(--ink)" }}
            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...BOUNCE, delay: 0.25 }}>
            Welcome back{firstName ? `, ${firstName}` : ""}
          </motion.p>
          <motion.p className="text-sm" style={{ color: "var(--muted)" }}
            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...BOUNCE, delay: 0.35 }}>
            Taking you to your dashboard…
          </motion.p>
        </div>
      </motion.div>
    </motion.div>
  );
}
