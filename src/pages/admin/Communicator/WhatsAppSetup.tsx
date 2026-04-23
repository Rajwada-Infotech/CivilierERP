import React, { useState } from "react";
import {
  MessageCircle,
  Link2,
  Key,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Copy,
  Settings2,
  Webhook,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const inp =
  "w-full h-11 rounded-lg px-4 text-sm outline-none transition-all duration-200 " +
  "bg-[#030f0a] border border-[#0d2a18] text-slate-100 placeholder:text-slate-600 " +
  "focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10";

const lbl =
  "block text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-600/80 mb-2";

function Card({
  children,
  delay = 0,
  accent = "emerald",
}: {
  children: React.ReactNode;
  delay?: number;
  accent?: string;
}) {
  const color =
    accent === "emerald" ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.08)";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-2xl p-6 overflow-hidden"
      style={{
        background: "linear-gradient(145deg, #051a0f, #030f0a)",
        border: "1px solid #0d2a18",
      }}
    >
      <motion.div
        className="absolute left-0 right-0 h-px pointer-events-none"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        }}
        initial={{ top: "0%" }}
        animate={{ top: ["0%", "100%"] }}
        transition={{ duration: 5, repeat: Infinity, ease: "linear", delay }}
      />
      {children}
    </motion.div>
  );
}

function SectionHeader({
  icon: Icon,
  label,
  badge,
}: {
  icon: any;
  label: string;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-6">
      <Icon size={13} className="text-emerald-400" />
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-400">
        {label}
      </span>
      {badge && (
        <span className="text-[9px] font-black px-2 py-0.5 rounded border border-amber-500/30 text-amber-400 bg-amber-500/10 tracking-widest">
          {badge}
        </span>
      )}
      <div className="flex-1 h-px bg-gradient-to-r from-emerald-500/20 to-transparent" />
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div
      className="flex items-center justify-between rounded-lg px-4 py-2.5 gap-3"
      style={{ background: "#030f0a", border: "1px solid #0d2a18" }}
    >
      <code
        className="text-xs text-emerald-400 truncate flex-1"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 transition-all duration-200 hover:text-emerald-400 text-slate-600"
      >
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.span
              key="ok"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="text-emerald-400"
            >
              <CheckCircle2 size={14} />
            </motion.span>
          ) : (
            <motion.span
              key="copy"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
            >
              <Copy size={14} />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  );
}

export default function WhatsAppSetup() {
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<"idle" | "connected">("idle");

  const handleVerify = () => {
    setIsVerifying(true);
    setStatus("idle");
    setTimeout(() => {
      setIsVerifying(false);
      setStatus("connected");
    }, 2200);
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
          className="relative w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: "linear-gradient(135deg,#051a0f,#030f0a)",
            border: "1px solid rgba(16,185,129,0.25)",
          }}
        >
          <MessageCircle size={22} className="text-emerald-400" />
          {status === "connected" && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative rounded-full h-3 w-3 bg-emerald-400" />
            </span>
          )}
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black tracking-tight text-white">
              WHATSAPP_API
            </h1>
            <span className="text-[9px] font-black px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-400 bg-emerald-500/10 tracking-[0.2em]">
              META
            </span>
          </div>
          <p
            className="text-xs text-slate-500 mt-0.5"
            style={{ fontFamily: "system-ui" }}
          >
            Connect your Meta Business account to send automated WhatsApp
            messages.
          </p>
        </div>
      </motion.div>

      <div className="grid xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 space-y-5">
          {/* API Credentials */}
          <Card delay={0.1}>
            <SectionHeader icon={Settings2} label="API Credentials" />
            <div className="space-y-4">
              <div>
                <label className={lbl}>Access Token</label>
                <div className="relative">
                  <input
                    type="password"
                    className={`${inp} pr-10`}
                    placeholder="EAAG…"
                  />
                  <Key
                    size={13}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none"
                  />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Phone Number ID</label>
                  <input
                    type="text"
                    className={inp}
                    placeholder="1092837465…"
                  />
                </div>
                <div>
                  <label className={lbl}>WABA ID</label>
                  <input type="text" className={inp} placeholder="987654321…" />
                </div>
              </div>
            </div>
          </Card>

          {/* Webhook */}
          <Card delay={0.18}>
            <SectionHeader
              icon={Link2}
              label="Webhook Configuration"
              badge="REQUIRED"
            />
            <div className="space-y-4">
              <div>
                <label className={lbl}>Callback URL</label>
                <CopyField value="https://api.yourdomain.com/webhooks/whatsapp" />
              </div>
              <div>
                <label className={lbl}>Verify Token</label>
                <CopyField value="wh_verify_civilier_2024_secure" />
              </div>
            </div>
            <div
              className="mt-5 px-4 py-3 rounded-lg flex items-start gap-3"
              style={{
                background: "rgba(245,158,11,0.06)",
                border: "1px solid rgba(245,158,11,0.15)",
              }}
            >
              <span className="text-amber-400 mt-0.5 shrink-0">⚠</span>
              <p
                className="text-xs text-amber-400/80 leading-relaxed"
                style={{ fontFamily: "system-ui" }}
              >
                Register this URL in your Meta App Dashboard under{" "}
                <strong>WhatsApp → Configuration → Webhooks</strong>.
              </p>
            </div>
          </Card>

          {/* Template status */}
          <Card delay={0.26}>
            <SectionHeader icon={ShieldCheck} label="Message Templates" />
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { name: "otp_verification", status: "APPROVED" },
                { name: "payment_alert", status: "PENDING" },
                { name: "task_update", status: "APPROVED" },
              ].map((t) => (
                <div
                  key={t.name}
                  className="rounded-lg p-3"
                  style={{ background: "#030f0a", border: "1px solid #0d2a18" }}
                >
                  <p className="text-[10px] text-slate-400 mb-1.5 truncate">
                    {t.name}
                  </p>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-widest ${t.status === "APPROVED" ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20" : "text-amber-400 bg-amber-500/10 border border-amber-500/20"}`}
                  >
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          {/* Connection indicator */}
          <Card delay={0.12}>
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600/80 block mb-4">
              API Status
            </span>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex h-4 w-4">
                {status === "connected" && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
                )}
                <span
                  className={`relative rounded-full h-4 w-4 ${status === "connected" ? "bg-emerald-400" : "bg-slate-800 border border-slate-700"}`}
                />
              </div>
              <span
                className="text-xs font-bold"
                style={{
                  color: status === "connected" ? "#34d399" : "#44403c",
                  fontFamily: "system-ui",
                }}
              >
                {status === "connected" ? "API CONNECTED" : "NOT VERIFIED"}
              </span>
            </div>
            {[
              { label: "Token Valid", ok: status === "connected" },
              { label: "Phone Number", ok: status === "connected" },
              { label: "Webhook Active", ok: false },
            ].map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between py-1.5"
                style={{ borderBottom: "1px solid #071a0f" }}
              >
                <span
                  className="text-xs text-slate-500"
                  style={{ fontFamily: "system-ui" }}
                >
                  {item.label}
                </span>
                <span
                  className={`text-[10px] font-bold ${item.ok ? "text-emerald-400" : "text-slate-600"}`}
                >
                  {item.ok ? "● OK" : "○ —"}
                </span>
              </div>
            ))}
          </Card>

          {/* Meta portal link */}
          <Card delay={0.2}>
            <div className="flex flex-col gap-3">
              <p
                className="text-xs font-bold text-slate-300"
                style={{ fontFamily: "system-ui" }}
              >
                Meta Developer Portal
              </p>
              <p
                className="text-xs text-slate-500 leading-relaxed"
                style={{ fontFamily: "system-ui" }}
              >
                Create an App in Meta's dashboard, add the WhatsApp product, and
                generate tokens from{" "}
                <span className="text-emerald-400">
                  Business Settings → API Setup
                </span>
                .
              </p>
              <a
                href="https://developers.facebook.com/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-bold tracking-wider transition-all duration-200"
                style={{
                  border: "1px solid rgba(16,185,129,0.3)",
                  color: "#34d399",
                  background: "rgba(16,185,129,0.05)",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "rgba(16,185,129,0.1)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "rgba(16,185,129,0.05)")
                }
              >
                META DASHBOARD <ExternalLink size={12} />
              </a>
            </div>
          </Card>

          {/* 24hr window */}
          <Card delay={0.28}>
            <p
              className="text-xs font-bold text-slate-300 mb-1.5"
              style={{ fontFamily: "system-ui" }}
            >
              24-Hour Rule
            </p>
            <p
              className="text-xs text-slate-500 leading-relaxed"
              style={{ fontFamily: "system-ui" }}
            >
              Free-form messages are only allowed within{" "}
              <span className="text-emerald-400">24 hours</span> of a user's
              last message. Outside this window, only approved templates may be
              sent.
            </p>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-5"
        style={{ borderTop: "1px solid #0d2a18" }}
      >
        <div className="flex items-center gap-4">
          <button
            onClick={handleVerify}
            disabled={isVerifying}
            className="h-10 px-5 rounded-lg text-xs font-bold tracking-widest transition-all duration-200 flex items-center gap-2 disabled:opacity-50"
            style={{
              border: "1px solid #0d2a18",
              color: "#64748b",
              background: "transparent",
            }}
            onMouseEnter={(e) =>
              !isVerifying && (e.currentTarget.style.color = "#34d399")
            }
            onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
          >
            {isVerifying ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Link2 size={13} />
            )}
            {isVerifying ? "VERIFYING…" : "VERIFY CONNECTION"}
          </button>
          <AnimatePresence>
            {status === "connected" && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-400"
              >
                <CheckCircle2 size={13} /> API CONNECTED
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className="h-10 px-8 rounded-lg text-xs font-black tracking-[0.2em] text-[#030f0a] transition-all"
          style={{
            background: "linear-gradient(135deg, #34d399, #059669)",
            boxShadow: "0 0 28px rgba(16,185,129,0.28)",
          }}
        >
          SAVE CHANGES
        </motion.button>
      </motion.div>
    </div>
  );
}
