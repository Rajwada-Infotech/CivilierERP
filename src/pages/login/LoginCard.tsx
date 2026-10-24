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

export function LoginCard(p: LoginCardProps) {
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="w-full max-w-[420px]">
      <div className="p-6 sm:p-0">
        {/* Header */}
        <div className="text-center ls-in" style={{ marginBottom: "min(2.5rem, 4.5vh)" }}>
          <div className="flex items-center gap-3 bw-color-keep">
            <img src="/Civilier.png" alt="CivilierERP" width={44} height={44} className="rounded-full object-cover bw-color-keep shrink-0" style={{ width: 44, height: 44, boxShadow: "0 0 0 1px var(--rule)" }} />
            <h1 className="font-heading font-bold text-lg tracking-tight" style={{ color: "var(--ink)" }}>CivilierERP</h1>
          </div>
          <p className="display text-left" style={{ fontSize: "clamp(34px, min(3.2vw, 6vh), 44px)", color: "var(--ink)", marginTop: "min(2.5rem, 4.5vh)" }}>
            Sign in to<br />continue<span style={{ color: "var(--hivis)" }}>.</span>
          </p>
        </div>

        {/* Form */}
        <form className="space-y-5 ls-in" style={{ animationDelay: "80ms" }} onSubmit={p.onSubmit}>
          <div>
            <label htmlFor="login-email" className="ls-label">Email address</label>
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
          </div>

          <div>
            <label htmlFor="login-password" className="ls-label">Password</label>
            <div className="relative">
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
                style={{ paddingRight: 52 }}
              />
              <button
                type="button"
                onClick={() => setShowPass((s) => !s)}
                aria-label={showPass ? "Hide password" : "Show password"}
                aria-pressed={showPass}
                className="ls-eye absolute right-1 top-1 h-[44px] w-[44px] flex items-center justify-center rounded-lg"
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {p.error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
                className="flex items-start gap-2.5 px-4 py-3 text-sm rounded-xl"
                style={{ background: "#fdecec", border: "1px solid #f3b9b9", color: "#9f1d1d" }}
              >
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{p.error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <button type="submit" disabled={p.isLoading || p.loginSuccess} className="ls-btn">
            <span>{p.isLoading ? "Signing in…" : "Sign in"}</span>
            <span className="chip">
              {p.isLoading ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <ArrowRight size={18} />}
            </span>
          </button>
        </form>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] ls-in" style={{ animationDelay: "140ms", color: "var(--graphite)" }}>
          <span>Secure access · Role-based permissions · v{p.appVersion}</span>
          <button type="button" onClick={() => p.onNavigate("/download-android-app")} className="ls-link inline-flex items-center gap-1.5 font-medium">
            <Smartphone size={14} />
            Get the Android app
          </button>
        </div>

        {/* Other portals */}
        <div className="ls-in" style={{ animationDelay: "200ms", marginTop: "min(3rem, 5vh)" }}>
          <p className="eyebrow mb-2" style={{ color: "var(--graphite)" }}>Looking for a different portal?</p>
          <div style={{ borderTop: "1px solid var(--rule)" }}>
            {[
              { path: "/supplier-login", title: "Supplier", note: "Vendor & order portal", Icon: Truck },
              { path: "/crm-client-portal/login", title: "Customer", note: "Booking & owner portal", Icon: Building2 },
            ].map(({ path, title, note, Icon }) => (
              <button key={path} type="button" onClick={() => p.onNavigate(path)}
                className="ls-row w-full flex items-center gap-4 px-2 py-3.5 text-left" style={{ borderBottom: "1px solid var(--rule)", borderRadius: 0 }}>
                <span className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-lg" style={{ background: "var(--hivis-wash)", color: "var(--hivis-deep)" }}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-heading font-semibold text-[15px]" style={{ color: "var(--ink)" }}>{title}</span>
                  <span className="block text-[13px]" style={{ color: "var(--graphite)" }}>{note}</span>
                </span>
                <ArrowUpRight size={18} className="ls-go shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
