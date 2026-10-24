// Shown for the moment between a successful sign-in and the dashboard opening.
import React from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

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
        initial={{ y: 12, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: -8, opacity: 0, transition: { duration: 0.18 } }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <span className="w-10 h-10 flex items-center justify-center shrink-0 rounded-full" style={{ background: "var(--green)" }}>
          <Check size={20} color="#fff" strokeWidth={3} />
        </span>
        <div>
          <p className="font-heading font-semibold text-lg tracking-tight" style={{ color: "var(--ink)" }}>Welcome back{firstName ? `, ${firstName}` : ""}</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>Taking you to your dashboard…</p>
        </div>
      </motion.div>
    </motion.div>
  );
}
