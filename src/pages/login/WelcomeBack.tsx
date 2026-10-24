// Shown for the moment between a successful sign-in and the dashboard opening.
import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

export function WelcomeBack({ name }: { name?: string }) {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  return (
    <motion.div
      className="absolute inset-0 z-[60] flex items-center justify-center px-4"
      style={{ background: "rgba(21,23,27,0.72)", backdropFilter: "blur(4px)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      role="status"
    >
      <motion.div
        className="flex items-center gap-4 pl-5 pr-7 py-5 rounded-2xl overflow-hidden relative"
        style={{ background: "var(--board)", color: "var(--chalk)" }}
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -8, opacity: 0, transition: { duration: 0.18 } }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <span className="w-11 h-11 flex items-center justify-center shrink-0 rounded-xl" style={{ background: "var(--hivis)" }}>
          <Check size={22} color="#fff" strokeWidth={3} />
        </span>
        <div>
          <p className="font-heading font-bold text-xl tracking-tight">Welcome back{firstName ? `, ${firstName}` : ""}</p>
          <p className="text-sm mt-0.5" style={{ color: "var(--chalk-2)" }}>Taking you to your dashboard…</p>
        </div>
        <span className="hazard absolute left-0 right-0 bottom-0 h-1" aria-hidden="true" />
      </motion.div>
    </motion.div>
  );
}
