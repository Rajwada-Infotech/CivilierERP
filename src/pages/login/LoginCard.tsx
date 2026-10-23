// The sign-in card: logo, email and password, and the way to the supplier and customer portals and the Android app.
// The nesting (p-6 > text-center > logo first) is what the black-and-white theme's CSS hooks into to keep the logo in colour.
import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowUpRight, Building2, Eye, EyeOff, Smartphone, Truck } from "lucide-react";

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
    <label htmlFor={id} className="label block mb-1.5">{label}</label>
    <div className="relative">{children}</div>
  </div>
);

export function LoginCard(p: LoginCardProps) {
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="w-full max-w-md ls-in" style={{ background: "var(--paper)", border: "1px solid var(--rule)" }}>
      <div className="p-6 sm:p-8">
        {/* Header */}
        <div className="text-center mb-7">
          <div className="flex flex-col items-center gap-3 bw-color-keep">
            <div className="p-1" style={{ border: "1px solid var(--rule)", borderRadius: "9999px" }}>
              <img src="/Civilier.png" alt="CivilierERP" width={72} height={72} className="rounded-full object-cover bw-color-keep" style={{ width: 72, height: 72 }} />
            </div>
            <h1 className="font-heading font-bold text-2xl tracking-tight" style={{ color: "var(--violet-soft)" }}>CivilierERP</h1>
          </div>
          <p className="label mt-2">Sign in to continue</p>
        </div>

        {/* Form */}
        <form className="space-y-4" onSubmit={p.onSubmit}>
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
              style={{ paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              aria-label={showPass ? "Hide password" : "Show password"}
              aria-pressed={showPass}
              className="ls-link absolute right-0 top-0 h-11 w-11 flex items-center justify-center"
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

          <button type="submit" disabled={p.isLoading || p.loginSuccess} className="ls-btn">
            {p.isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in →"
            )}
          </button>
        </form>

        <p className="label text-center mt-5" style={{ letterSpacing: "0.1em" }}>
          Secure access · Role-based permissions · v{p.appVersion}
        </p>

        <button type="button" onClick={() => p.onNavigate("/download-android-app")} className="ls-link flex items-center justify-center gap-1.5 mx-auto mt-3 text-[0.6875rem] font-medium">
          <Smartphone size={12} style={{ color: "var(--violet-soft)" }} />
          Get the Android app
        </button>

        {/* Other portals */}
        <div className="mt-5 pt-5" style={{ borderTop: "1px solid var(--rule-soft)" }}>
          <p className="label text-center mb-3">Looking for a different portal?</p>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { path: "/supplier-login", title: "Supplier", note: "Vendor & order portal", Icon: Truck, tone: "#34d399" },
              { path: "/crm-client-portal/login", title: "Customer", note: "Booking & owner portal", Icon: Building2, tone: "#f87171" },
            ].map(({ path, title, note, Icon, tone }) => (
              <button key={path} type="button" onClick={() => p.onNavigate(path)} className="ls-tile group flex flex-col items-start gap-2 p-3 text-left">
                <div className="flex items-center justify-between w-full">
                  <Icon size={15} style={{ color: tone }} />
                  <ArrowUpRight size={13} style={{ color: "var(--graphite)" }} />
                </div>
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--ink)" }}>{title}</p>
                  <p className="text-[0.625rem]" style={{ color: "var(--graphite)" }}>{note}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
