import React, { useState } from "react";
import {
  MessageSquare,
  Key,
  Smartphone,
  CheckCircle2,
  Loader2,
  Zap,
  ChevronDown,
  Send,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const inp =
  "w-full h-11 rounded-lg px-4 text-sm outline-none transition-all duration-200 " +
  "bg-[#0d0a04] border border-[#2d2010] text-slate-100 placeholder:text-slate-600 " +
  "focus:border-amber-500/50 focus:ring-2 focus:ring-amber-500/10";

const lbl =
  "block text-[10px] font-bold uppercase tracking-[0.15em] text-amber-600/80 mb-2";

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
        background: "linear-gradient(145deg, #130f05, #0d0a04)",
        border: "1px solid #2d2010",
      }}
    >
      <motion.div
        className="absolute left-0 right-0 h-px pointer-events-none"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(245,158,11,0.18), transparent)",
        }}
        initial={{ top: "0%" }}
        animate={{ top: ["0%", "100%"] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "linear", delay }}
      />
      {children}
    </motion.div>
  );
}

function SectionHeader({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-6">
      <Icon size={13} className="text-amber-500" />
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-500">
        {label}
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-amber-500/20 to-transparent" />
    </div>
  );
}

const PROVIDERS = [
  "Twilio",
  "Vonage (Nexmo)",
  "MessageBird",
  "AWS SNS",
  "Custom HTTP API",
];

export default function SmsSetup() {
  const [isTesting, setIsTesting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success">("idle");
  const [provider, setProvider] = useState("Twilio");
  const [msgType, setMsgType] = useState<"transactional" | "promotional">(
    "transactional",
  );

  const handleTest = () => {
    setIsTesting(true);
    setStatus("idle");
    setTimeout(() => {
      setIsTesting(false);
      setStatus("success");
    }, 1800);
  };

  return (
    <div
      className="w-full max-w-6xl mx-auto p-6 space-y-6"
      style={{ fontFamily: "'DM Mono', 'Fira Code', monospace" }}
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-4 mb-2"
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg,#1a1005,#0d0a04)",
            border: "1px solid rgba(245,158,11,0.25)",
          }}
        >
          <MessageSquare size={22} className="text-amber-500" />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black tracking-tight text-white">
              SMS_GATEWAY
            </h1>
            <span className="text-[9px] font-black px-2 py-0.5 rounded border border-amber-500/30 text-amber-400 bg-amber-500/10 tracking-[0.2em]">
              A2P
            </span>
          </div>
          <p
            className="text-xs text-slate-500 mt-0.5"
            style={{ fontFamily: "system-ui" }}
          >
            Configure SMS gateway for alerts, 2FA codes, and customer
            notifications.
          </p>
        </div>
      </motion.div>

      <div className="grid xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          {/* Provider selection */}
          <Card delay={0.1}>
            <SectionHeader icon={Zap} label="Gateway Provider" />
            <div className="grid sm:grid-cols-3 gap-3">
              {PROVIDERS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProvider(p)}
                  className="px-3 py-2.5 rounded-lg text-xs font-bold text-left transition-all duration-200"
                  style={
                    provider === p
                      ? {
                          background: "rgba(245,158,11,0.12)",
                          border: "1px solid rgba(245,158,11,0.4)",
                          color: "#fbbf24",
                        }
                      : {
                          background: "transparent",
                          border: "1px solid #2d2010",
                          color: "#57534e",
                        }
                  }
                >
                  {p}
                </button>
              ))}
            </div>
          </Card>

          {/* API credentials */}
          <Card delay={0.18}>
            <SectionHeader icon={Key} label="API Credentials" />
            <div className="space-y-4">
              <div>
                <label className={lbl}>Account SID / API Key</label>
                <input
                  type="text"
                  className={inp}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
              <div>
                <label className={lbl}>Auth Token / Secret</label>
                <input
                  type="password"
                  className={inp}
                  placeholder="••••••••••••••••••••"
                />
              </div>
            </div>
          </Card>

          {/* Sender details */}
          <Card delay={0.24}>
            <SectionHeader icon={Smartphone} label="Sender Details" />
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>From Number (E.164)</label>
                <input type="text" className={inp} placeholder="+12025551234" />
              </div>
              <div>
                <label className={lbl}>Sender ID / Name</label>
                <input type="text" className={inp} placeholder="CIVILIER" />
              </div>
            </div>
            <div className="mt-5">
              <label className={lbl}>Message Type</label>
              <div className="flex gap-2 mt-1">
                {(["transactional", "promotional"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMsgType(t)}
                    className="px-4 h-9 rounded-lg text-xs font-bold tracking-wider capitalize transition-all duration-200"
                    style={
                      msgType === t
                        ? {
                            background: "rgba(245,158,11,0.12)",
                            border: "1px solid rgba(245,158,11,0.4)",
                            color: "#fbbf24",
                          }
                        : {
                            background: "transparent",
                            border: "1px solid #2d2010",
                            color: "#57534e",
                          }
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Signal meter */}
          <Card delay={0.12}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600/80 block mb-4">
              Signal Status
            </span>
            <div className="flex items-end gap-1 h-10 mb-3">
              {[0.3, 0.5, 0.7, 1, 1].map((h, i) => (
                <motion.div
                  key={i}
                  className="flex-1 rounded-sm"
                  style={{
                    background:
                      status === "success"
                        ? `rgba(245,158,11,${h})`
                        : `rgba(245,158,11,0.1)`,
                    height: `${h * 100}%`,
                  }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: 0.12 + i * 0.05 }}
                />
              ))}
            </div>
            <p
              className="text-xs font-bold"
              style={{
                color: status === "success" ? "#f59e0b" : "#44403c",
                fontFamily: "system-ui",
              }}
            >
              {status === "success" ? "▲  GATEWAY REACHABLE" : "○  NOT TESTED"}
            </p>
          </Card>

          {/* Compliance */}
          <Card delay={0.2}>
            <Zap size={16} className="text-amber-500 mb-3" />
            <p
              className="text-xs font-bold text-slate-300 mb-1.5"
              style={{ fontFamily: "system-ui" }}
            >
              A2P Compliance
            </p>
            <p
              className="text-xs text-slate-500 leading-relaxed"
              style={{ fontFamily: "system-ui" }}
            >
              Ensure proper{" "}
              <span className="text-amber-400">opt-in consent</span> is
              collected before messaging. Violations can result in carrier
              blocks.
            </p>
          </Card>

          {/* Rate limits */}
          <Card delay={0.28}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600/80 block mb-3">
              Rate Limits
            </span>
            {[
              { label: "Per Second", val: "1 msg/s" },
              { label: "Per Day", val: "1,000 msgs" },
              { label: "Per Number", val: "200 msgs" },
            ].map((r) => (
              <div
                key={r.label}
                className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid #1a1005" }}
              >
                <span
                  className="text-xs text-slate-500"
                  style={{ fontFamily: "system-ui" }}
                >
                  {r.label}
                </span>
                <span className="text-xs font-bold text-amber-600">
                  {r.val}
                </span>
              </div>
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
        style={{ borderTop: "1px solid #2d2010" }}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="h-10 px-5 rounded-lg text-xs font-bold tracking-widest transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
            style={{
              border: "1px solid #2d2010",
              color: "#78716c",
              background: "transparent",
            }}
            onMouseEnter={(e) =>
              !isTesting && (e.currentTarget.style.color = "#f59e0b")
            }
            onMouseLeave={(e) => (e.currentTarget.style.color = "#78716c")}
          >
            {isTesting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} />
            )}
            {isTesting ? "SENDING…" : "SEND TEST SMS"}
          </button>
          <AnimatePresence>
            {status === "success" && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-xs font-bold"
                style={{ color: "#f59e0b" }}
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
            background: "linear-gradient(135deg, #fbbf24, #d97706)",
            boxShadow: "0 0 28px rgba(245,158,11,0.3)",
          }}
        >
          SAVE SETTINGS
        </motion.button>
      </motion.div>
    </div>
  );
}
