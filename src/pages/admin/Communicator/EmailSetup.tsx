import React, { useState, useEffect } from "react";
import {
  Mail,
  Server,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
  Send,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const inp =
  "w-full h-11 rounded-lg px-4 text-sm outline-none transition-all duration-200 " +
  "bg-[#060c14] border border-[#1a2d42] text-slate-100 placeholder:text-slate-600 " +
  "focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10";

const lbl =
  "block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-2";

function SectionHeader({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-6">
      <Icon size={13} className="text-cyan-400" />
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-400">
        {label}
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/20 to-transparent" />
    </div>
  );
}

function Card({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-2xl p-6 overflow-hidden"
      style={{
        background: "linear-gradient(145deg, #0d1a2a, #0a1320)",
        border: "1px solid #1a2d42",
      }}
    >
      {/* Subtle scan line */}
      <motion.div
        className="absolute left-0 right-0 h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(6,182,212,0.2), transparent)",
        }}
        initial={{ top: "0%" }}
        animate={{ top: ["0%", "100%"] }}
        transition={{ duration: 5, repeat: Infinity, ease: "linear", delay }}
      />
      {children}
    </motion.div>
  );
}

export default function EmailSetup() {
  const [isTesting, setIsTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success">("idle");
  const [showPass, setShowPass] = useState(false);
  const [encryption, setEncryption] = useState<"TLS" | "SSL" | "None">("TLS");

  const handleTest = () => {
    setIsTesting(true);
    setStatus("idle");
    setTimeout(() => {
      setIsTesting(false);
      setStatus("success");
    }, 2000);
  };

  return (
    <div
      className="w-full max-w-6xl mx-auto p-6 space-y-6"
      style={{ fontFamily: "'DM Mono', 'Fira Code', monospace" }}
    >
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-4 mb-2"
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg,#0e2038,#071424)",
            border: "1px solid rgba(6,182,212,0.25)",
          }}
        >
          <Mail size={22} className="text-cyan-400" />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black tracking-tight text-white">
              EMAIL_CONFIG
            </h1>
            <span className="text-[9px] font-black px-2 py-0.5 rounded border border-cyan-500/30 text-cyan-400 bg-cyan-500/10 tracking-[0.2em]">
              SMTP
            </span>
          </div>
          <p
            className="text-xs text-slate-500 mt-0.5"
            style={{ fontFamily: "system-ui" }}
          >
            Configure outbound mail server for notifications and system
            communications.
          </p>
        </div>
      </motion.div>

      <div className="grid xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          {/* Credentials */}
          <Card delay={0.1}>
            <SectionHeader icon={KeyRound} label="SMTP Credentials" />
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={lbl}>Sender Email Address</label>
                <input
                  type="email"
                  className={inp}
                  placeholder="notifications@company.com"
                />
              </div>
              <div>
                <label className={lbl}>SMTP Username</label>
                <input
                  type="text"
                  className={inp}
                  placeholder="user@smtp.com"
                />
              </div>
              <div>
                <label className={lbl}>SMTP Password</label>
                <div className="relative">
                  <input
                    type={showPass ? "text" : "password"}
                    className={`${inp} pr-11`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-cyan-400 transition-colors"
                  >
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </Card>

          {/* Server */}
          <Card delay={0.18}>
            <SectionHeader icon={Server} label="Server Settings" />
            <div className="grid sm:grid-cols-3 gap-4 mb-5">
              <div className="sm:col-span-2">
                <label className={lbl}>SMTP Host</label>
                <input
                  type="text"
                  className={inp}
                  placeholder="smtp.provider.com"
                />
              </div>
              <div>
                <label className={lbl}>Port</label>
                <input type="text" className={inp} placeholder="587" />
              </div>
            </div>
            <div>
              <label className={lbl}>Encryption</label>
              <div className="flex gap-2 mt-1">
                {(["TLS", "SSL", "None"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setEncryption(opt)}
                    className="px-4 h-9 rounded-lg text-xs font-bold tracking-widest transition-all duration-200"
                    style={
                      encryption === opt
                        ? {
                            background: "rgba(6,182,212,0.12)",
                            border: "1px solid rgba(6,182,212,0.45)",
                            color: "#22d3ee",
                          }
                        : {
                            background: "transparent",
                            border: "1px solid #1e2d45",
                            color: "#475569",
                          }
                    }
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Connection status */}
          <Card delay={0.12}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Connection
              </span>
              <span className="relative flex h-2.5 w-2.5">
                {status === "success" && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-50" />
                )}
                <span
                  className={`relative rounded-full h-2.5 w-2.5 ${status === "success" ? "bg-cyan-400" : "bg-slate-700"}`}
                />
              </span>
            </div>
            {[
              { label: "SMTP Auth", ok: status === "success" },
              { label: "TLS Handshake", ok: status === "success" },
              { label: "Relay OK", ok: status === "success" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid #121e2d" }}
              >
                <span
                  className="text-xs text-slate-500"
                  style={{ fontFamily: "system-ui" }}
                >
                  {item.label}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${item.ok ? "text-cyan-400" : "text-slate-600"}`}
                >
                  {item.ok ? "●  OK" : "○  —"}
                </span>
              </div>
            ))}
          </Card>

          {/* Security note */}
          <Card delay={0.2}>
            <ShieldCheck size={16} className="text-cyan-400 mb-3" />
            <p
              className="text-xs font-bold text-slate-300 mb-1.5"
              style={{ fontFamily: "system-ui" }}
            >
              App Passwords
            </p>
            <p
              className="text-xs text-slate-500 leading-relaxed"
              style={{ fontFamily: "system-ui" }}
            >
              For Gmail/Outlook, generate an{" "}
              <span className="text-cyan-400">App Password</span> instead of
              using your primary login credentials.
            </p>
          </Card>

          {/* Quick presets */}
          <Card delay={0.26}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-3">
              Quick Presets
            </span>
            {[
              { name: "Gmail", host: "smtp.gmail.com:587" },
              { name: "Outlook", host: "smtp.office365.com:587" },
              { name: "SendGrid", host: "smtp.sendgrid.net:465" },
            ].map((p) => (
              <button
                key={p.name}
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 mb-1.5 rounded-lg transition-all duration-150 group"
                style={{
                  border: "1px solid #1a2d42",
                  background: "transparent",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "rgba(6,182,212,0.3)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "#1a2d42")
                }
              >
                <span
                  className="text-xs font-bold text-slate-400 group-hover:text-cyan-400 transition-colors"
                  style={{ fontFamily: "system-ui" }}
                >
                  {p.name}
                </span>
                <span className="text-[10px] text-slate-600">{p.host}</span>
              </button>
            ))}
          </Card>
        </div>
      </div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-5"
        style={{ borderTop: "1px solid #1a2d42" }}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="h-10 px-5 rounded-lg text-xs font-bold tracking-widest transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
            style={{
              border: "1px solid #1e2d45",
              color: "#64748b",
              background: "transparent",
            }}
            onMouseEnter={(e) =>
              !isTesting && (e.currentTarget.style.color = "#22d3ee")
            }
            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
          >
            {isTesting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} />
            )}
            {isTesting ? "SENDING…" : "TEST EMAIL"}
          </button>
          <AnimatePresence>
            {status === "success" && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-xs text-cyan-400 font-bold"
              >
                <CheckCircle2 size={13} /> DELIVERED
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className="h-10 px-8 rounded-lg text-xs font-black tracking-[0.2em] text-[#040810] transition-all"
          style={{
            background: "linear-gradient(135deg, #22d3ee, #0891b2)",
            boxShadow: "0 0 28px rgba(6,182,212,0.3)",
          }}
        >
          SAVE CONFIG
        </motion.button>
      </motion.div>
    </div>
  );
}
