// Shown for the moment between a successful sign-in and the dashboard opening.
import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

export function WelcomeBack({ name }: { name?: string }) {
  const firstName = name?.trim().split(/\s+/)[0] || "";
  return (
    <motion.div
      className="absolute inset-0 z-[60] flex items-center justify-center px-4"
      style={{ background: "rgba(13,10,26,0.82)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
      role="status"
    >
      <motion.div
        className="flex items-center gap-4 px-6 py-5"
        style={{ background: "var(--paper)", border: "1px solid var(--rule)", boxShadow: "6px 6px 0 rgba(139,92,246,0.18)" }}
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -8, opacity: 0, transition: { duration: 0.18 } }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <span className="w-10 h-10 flex items-center justify-center shrink-0" style={{ background: "var(--violet-deep)", border: "1px solid var(--violet)" }}>
          <Check size={20} color="#fff" strokeWidth={3} />
        </span>
        <div>
          <p className="font-heading font-bold text-lg tracking-tight" style={{ color: "var(--violet-soft)" }}>
            Welcome back{firstName ? `, ${firstName}` : ""}
          </p>
          <p className="label mt-1">Taking you to your dashboard…</p>
        </div>
      </motion.div>
    </motion.div>
  );
}
