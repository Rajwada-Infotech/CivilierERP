// The sign-in side: logo and name, "Welcome back", email and password, then the supplier and customer portals and
// the Android app. The nesting (p-6 > text-center > logo first) is what the black-and-white theme's CSS hooks into
// to keep the logo in colour.
import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Building2, Eye, EyeOff, Truck } from "lucide-react";

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
    <div className="w-full max-w-[380px]">
      <div className="p-6 sm:p-0">
        {/* Logo, name and greeting */}
        <div className="text-center ls-in">
          <div className="flex items-center justify-center gap-2.5 bw-color-keep">
            <img src="/Civilier.png" alt="CivilierERP" width={40} height={40} className="rounded-full object-cover bw-color-keep" style={{ width: 40, height: 40 }} />
            <span className="font-heading font-semibold text-xl tracking-tight" style={{ color: "var(--brand)" }}>CivilierERP</span>
          </div>
          <h1 className="font-heading font-bold tracking-tight mt-[min(2rem,3.5vh)]" style={{ fontSize: "clamp(30px, 2.6vw, 38px)", lineHeight: 1.1, color: "var(--ink)" }}>Welcome back</h1>
          <p className="text-sm mt-2" style={{ color: "var(--ink-2)" }}>Sign in to continue</p>
        </div>

        <form className="mt-[min(2rem,3.5vh)] space-y-3.5 ls-in" style={{ animationDelay: "60ms" }} onSubmit={p.onSubmit}>
          <label className="ls-field" htmlFor="login-email">
            <span>Email address</span>
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
            />
          </label>

          <label className="ls-field" htmlFor="login-password" style={{ paddingRight: 48 }}>
            <span>Password</span>
            <input
              id="login-password"
              name="password"
              type={showPass ? "text" : "password"}
              autoComplete="current-password"
              required
              value={p.password}
              onChange={(e) => p.onPassword(e.target.value)}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              aria-label={showPass ? "Hide password" : "Show password"}
              aria-pressed={showPass}
              className="ls-eye absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center rounded-lg"
            >
              {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </label>

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

          <p className="text-xs pt-0.5" style={{ color: "var(--muted)" }}>Secure access · Role-based permissions</p>

          <button type="submit" disabled={p.isLoading || p.loginSuccess} className="ls-btn">
            {p.isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        {/* The other portals */}
        <div className="mt-[min(1.75rem,3vh)] ls-in" style={{ animationDelay: "120ms" }}>
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }}>
            <span className="h-px flex-1" style={{ background: "var(--line)" }} />
            Or
            <span className="h-px flex-1" style={{ background: "var(--line)" }} />
          </div>
          <div className="mt-[min(1.25rem,2.2vh)] space-y-3">
            <button type="button" onClick={() => p.onNavigate("/supplier-login")} className="ls-outline" title="Vendor & order portal">
              <Truck size={17} style={{ color: "var(--brand)" }} /> Supplier Portal
            </button>
            <button type="button" onClick={() => p.onNavigate("/crm-client-portal/login")} className="ls-outline" title="Booking & owner portal">
              <Building2 size={17} style={{ color: "var(--brand)" }} /> Customer Portal
            </button>
          </div>
        </div>

        <p className="mt-[min(1.75rem,3vh)] text-center text-sm ls-in" style={{ color: "var(--ink-2)", animationDelay: "160ms" }}>
          On your phone?{" "}
          <button type="button" onClick={() => p.onNavigate("/download-android-app")} className="ls-link">Get the Android app</button>
        </p>
        <p className="mt-2 text-center text-[11px]" style={{ color: "var(--muted)" }}>v{p.appVersion}</p>
      </div>
    </div>
  );
}
