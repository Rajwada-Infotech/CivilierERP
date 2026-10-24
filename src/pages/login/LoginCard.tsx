// The sign-in column: logo and name, the card with email and password, then the Android app and the supplier and
// customer portals. The nesting (p-6 > text-center > logo first) is what the black-and-white theme's CSS hooks into
// to keep the logo in colour.
import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, Building2, Eye, EyeOff, Smartphone, Truck } from "lucide-react";

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
    <div className="w-full max-w-[400px]">
      <div className="p-6 sm:p-0">
        {/* Logo and name above the card */}
        <div className="text-center ls-in">
          <div className="flex flex-col items-center bw-color-keep">
            <img src="/Civilier.png" alt="CivilierERP" width={56} height={56} className="rounded-full object-cover bw-color-keep" style={{ width: 56, height: 56, boxShadow: "0 0 0 1px var(--line), 0 6px 16px -6px rgba(17,18,20,0.18)" }} />
            <h1 className="font-heading font-bold text-xl tracking-tight mt-4" style={{ color: "var(--ink)" }}>CivilierERP</h1>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>Manage smarter, build better.</p>
        </div>

        {/* The card */}
        <div className="ls-card mt-8 p-7 sm:p-8 ls-in" style={{ animationDelay: "60ms" }}>
          <h2 className="font-heading font-semibold text-[22px] tracking-tight" style={{ color: "var(--ink)" }}>Sign in to continue</h2>
          <p className="text-[13px] mt-1" style={{ color: "var(--muted)" }}>Secure access · Role-based permissions</p>

          <form className="mt-6 space-y-4" onSubmit={p.onSubmit}>
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
                  style={{ paddingRight: 46 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  aria-pressed={showPass}
                  className="ls-eye absolute right-1 top-1 h-[38px] w-[38px] flex items-center justify-center rounded-lg"
                >
                  {showPass ? <EyeOff size={17} /> : <Eye size={17} />}
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
                  className="flex items-start gap-2 px-3 py-2.5 text-[13px] rounded-lg"
                  style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" }}
                >
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <span>{p.error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <button type="submit" disabled={p.isLoading || p.loginSuccess} className="ls-btn !mt-6">
              {p.isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Below the card: the app and the other portals, as quiet links */}
        <div className="mt-6 flex flex-col items-center gap-3 text-[13px] ls-in" style={{ animationDelay: "120ms" }}>
          <button type="button" onClick={() => p.onNavigate("/download-android-app")} className="ls-link inline-flex items-center gap-1.5">
            <Smartphone size={14} /> Get the Android app
          </button>
          <div className="flex items-center gap-2" style={{ color: "var(--muted)" }}>
            <span>Looking for a different portal?</span>
          </div>
          <div className="flex items-center gap-5">
            <button type="button" onClick={() => p.onNavigate("/supplier-login")} className="ls-link inline-flex items-center gap-1.5 font-medium" title="Vendor & order portal">
              <Truck size={14} /> Supplier
            </button>
            <span className="h-3 w-px" style={{ background: "var(--line-2)" }} />
            <button type="button" onClick={() => p.onNavigate("/crm-client-portal/login")} className="ls-link inline-flex items-center gap-1.5 font-medium" title="Booking & owner portal">
              <Building2 size={14} /> Customer
            </button>
          </div>
          <span className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>v{p.appVersion}</span>
        </div>
      </div>
    </div>
  );
}
