// The sign-in card: logo, email and password, and the way to the supplier and customer portals and the Android app.
// The nesting (p-6 > text-center > logo first) is what the black-and-white theme's CSS hooks into to keep the logo in colour.
import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, ArrowUpRight, Building2, Eye, EyeOff, Smartphone, Truck } from "lucide-react";

export interface LoginCardProps {
  email: string;
  password: string;
  error: string;
  isLoading: boolean;
  loginSuccess: boolean;
  appVersion: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onNavigate: (path: string) => void;
}

const Field: React.FC<{ id: string; label: string; children: React.ReactNode }> = ({ id, label, children }) => (
  <div>
    <label htmlFor={id} className="label block mb-2">{label}</label>
    <div className="relative">{children}</div>
  </div>
);

export function LoginCard(p: LoginCardProps) {
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="w-full max-w-[400px] ls-in">
      <div className="p-6 sm:p-0">
        {/* Header: the logo and name on one line, then the page's own heading */}
        <div className="text-center sm:text-left mb-9">
          <div className="flex items-center justify-center sm:justify-start gap-3 bw-color-keep">
            <div className="p-[3px] shrink-0" style={{ border: "1px solid var(--rule)", borderRadius: "9999px" }}>
              <img src="/Civilier.png" alt="CivilierERP" width={48} height={48} className="rounded-full object-cover bw-color-keep" style={{ width: 48, height: 48 }} />
            </div>
            <h1 className="font-heading font-bold text-xl tracking-tight" style={{ color: "var(--violet-soft)" }}>CivilierERP</h1>
          </div>
          <p className="font-heading font-bold mt-8" style={{ fontSize: 30, lineHeight: 1.1, letterSpacing: "-0.025em", color: "var(--ink)" }}>Sign in to continue</p>
        </div>

        {/* Form */}
        <form className="space-y-5" onSubmit={p.onSubmit}>
          <Field id="login-email" label="Email address">
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              value={p.email}
              onChange={(e) => p.onEmail(e.target.value)}
              placeholder="name@company.com"
              className="ls-input"
            />
          </Field>

          <Field id="login-password" label="Password">
            <input
              id="login-password"
              name="password"
              type={showPass ? "text" : "password"}
              autoComplete="current-password"
              required
              value={p.password}
              onChange={(e) => p.onPassword(e.target.value)}
              placeholder="••••••••"
              className="ls-input"
              style={{ paddingRight: 48 }}
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              aria-label={showPass ? "Hide password" : "Show password"}
              aria-pressed={showPass}
              className="ls-link absolute right-0 top-0 h-12 w-12 flex items-center justify-center"
            >
              {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </Field>

          <AnimatePresence>
            {p.error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="flex items-start gap-2 px-3 py-2.5 text-sm"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(248,113,113,0.55)", color: "#fca5a5" }}
              >
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{p.error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <button type="submit" disabled={p.isLoading || p.loginSuccess} className="ls-btn group">
            {p.isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="label" style={{ letterSpacing: "0.1em" }}>Secure access · Role-based permissions · v{p.appVersion}</p>
          <button type="button" onClick={() => p.onNavigate("/download-android-app")} className="ls-link flex items-center gap-1.5 text-xs font-medium">
            <Smartphone size={13} style={{ color: "var(--violet-soft)" }} />
            Get the Android app
          </button>
        </div>

        {/* Other portals */}
        <div className="mt-10">
          <div className="flex items-center gap-3 mb-3">
            <p className="label shrink-0">Looking for a different portal?</p>
            <span className="h-px flex-1" style={{ background: "var(--rule-soft)" }} />
          </div>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            {[
              { path: "/supplier-login", title: "Supplier", note: "Vendor & order portal", Icon: Truck, tone: "#34d399" },
              { path: "/crm-client-portal/login", title: "Customer", note: "Booking & owner portal", Icon: Building2, tone: "#f87171" },
            ].map(({ path, title, note, Icon, tone }) => (
              <button key={path} type="button" onClick={() => p.onNavigate(path)} className="ls-tile group flex items-center gap-3 p-3.5 text-left">
                <span className="w-9 h-9 shrink-0 inline-flex items-center justify-center" style={{ border: "1px solid var(--rule-soft)" }}>
                  <Icon size={16} style={{ color: tone }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{title}</span>
                    <ArrowUpRight size={13} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" style={{ color: "var(--graphite)" }} />
                  </span>
                  <span className="block text-[0.6875rem] leading-snug" style={{ color: "var(--graphite)" }}>{note}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
