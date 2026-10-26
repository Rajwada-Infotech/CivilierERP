// The sign-in side: logo and name, "Welcome back", email and password, then the supplier and customer portals and
// the Android app. The nesting (p-6 > text-center > logo first) is what the black-and-white theme's CSS hooks into
// to keep the logo in colour. Each part hops in after the one before (./motion); a wrong password shakes the form.
import React, { useEffect, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { AlertCircle, Building2, Eye, EyeOff, Truck } from "lucide-react";
import { BOUNCE, cascade, hop, pop } from "./motion";

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

// The black-and-white theme keeps the logo in colour with transform: translateZ(0) on .bw-color-keep; an animated
// transform would replace it, so the logo's motion always ends with that piece.
const keepLayer = (_: unknown, generated: string) => (generated === "none" ? "translateZ(0)" : `${generated} translateZ(0)`);

const press = { whileHover: { y: -2, scale: 1.015 }, whileTap: { y: 1, scale: 0.97 }, transition: BOUNCE };

export function LoginCard(p: LoginCardProps) {
  const [showPass, setShowPass] = useState(false);
  const shake = useAnimationControls();

  useEffect(() => {
    if (p.error) shake.start({ x: [0, -10, 9, -6, 4, -2, 0], transition: { duration: 0.5, ease: "easeOut" } });
  }, [p.error, shake]);

  return (
    <motion.div className="relative z-[1] w-full max-w-[380px]" variants={cascade(0.25, 0.09)} initial="hidden" animate="show">
      <div className="p-6 sm:p-0">
        {/* Logo, name and greeting */}
        <motion.div className="text-center" variants={cascade(0, 0.08)}>
          <motion.div className="flex items-center justify-center gap-2.5 bw-color-keep" variants={pop} transformTemplate={keepLayer}>
            <motion.img
              src="/Civilier.png" alt="CivilierERP" width={40} height={40}
              className="rounded-full object-cover bw-color-keep" style={{ width: 40, height: 40 }}
              transformTemplate={keepLayer}
              initial={{ y: -40, rotate: -20 }}
              animate={{ y: [-40, 0, -6, 0], rotate: [-20, 0, 0, 0] }}
              transition={{ duration: 0.9, times: [0, 0.55, 0.78, 1], ease: "easeOut", delay: 0.3 }}
              whileHover={{ rotate: 360, transition: { duration: 0.8, ease: "easeInOut" } }}
            />
            <span className="font-heading font-semibold text-xl tracking-tight" style={{ color: "var(--brand)" }}>CivilierERP</span>
          </motion.div>
          <motion.h1
            className="font-heading font-bold tracking-tight mt-[min(2rem,3.5vh)]"
            style={{ fontSize: "clamp(30px, 2.6vw, 38px)", lineHeight: 1.1, color: "var(--ink)" }}
            variants={cascade(0, 0.12)}
            aria-label="Welcome back"
          >
            {["Welcome", "back"].map((w, i) => (
              <motion.span key={w} className="inline-block" variants={pop} aria-hidden>
                {w}{i === 0 ? " " : ""}
              </motion.span>
            ))}
          </motion.h1>
          <motion.p className="text-sm mt-2" style={{ color: "var(--ink-2)" }} variants={hop}>Sign in to continue</motion.p>
        </motion.div>

        <motion.form className="mt-[min(2rem,3.5vh)] space-y-3.5" onSubmit={p.onSubmit} variants={cascade(0, 0.08)} animate={shake}>
          <motion.label className="ls-field" htmlFor="login-email" variants={hop}>
            <span>Email address</span>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={p.email}
              onChange={(e) => p.onEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </motion.label>

          <motion.label className="ls-field" htmlFor="login-password" style={{ paddingRight: 48 }} variants={hop}>
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
            <motion.button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              aria-label={showPass ? "Hide password" : "Show password"}
              aria-pressed={showPass}
              className="ls-eye absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center rounded-lg"
              whileTap={{ scale: 0.8 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={showPass ? "hide" : "show"}
                  initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
                  animate={{ rotate: 0, scale: 1, opacity: 1 }}
                  exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                  className="flex"
                >
                  {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </motion.label>

          <AnimatePresence>
            {p.error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={BOUNCE}
                className="flex items-start gap-2 px-3 py-2.5 text-[13px] rounded-lg"
                style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" }}
              >
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{p.error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.p className="text-xs pt-0.5" style={{ color: "var(--muted)" }} variants={hop}>Secure access · Role-based permissions</motion.p>

          <motion.button type="submit" disabled={p.isLoading || p.loginSuccess} className="ls-btn ls-shine" variants={hop} {...(p.isLoading || p.loginSuccess ? {} : press)}>
            {p.isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </motion.button>
        </motion.form>

        {/* The other portals */}
        <motion.div className="mt-[min(1.75rem,3vh)]" variants={cascade(0, 0.08)}>
          <motion.div className="flex items-center gap-3 text-xs" style={{ color: "var(--muted)" }} variants={hop}>
            <motion.span className="h-px flex-1 origin-right" style={{ background: "var(--line)" }} variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 0.6, ease: "easeOut" } } }} />
            Or
            <motion.span className="h-px flex-1 origin-left" style={{ background: "var(--line)" }} variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 0.6, ease: "easeOut" } } }} />
          </motion.div>
          <div className="mt-[min(1.25rem,2.2vh)] space-y-3">
            <motion.button type="button" onClick={() => p.onNavigate("/supplier-login")} className="ls-outline" title="Vendor & order portal" variants={hop} {...press}>
              <Truck size={17} style={{ color: "var(--brand)" }} /> Supplier Portal
            </motion.button>
            <motion.button type="button" onClick={() => p.onNavigate("/crm-client-portal/login")} className="ls-outline" title="Booking & owner portal" variants={hop} {...press}>
              <Building2 size={17} style={{ color: "var(--brand)" }} /> Customer Portal
            </motion.button>
          </div>
        </motion.div>

        <motion.p className="mt-[min(1.75rem,3vh)] text-center text-sm" style={{ color: "var(--ink-2)" }} variants={hop}>
          On your phone?{" "}
          <button type="button" onClick={() => p.onNavigate("/download-android-app")} className="ls-link">Get the Android app</button>
        </motion.p>
        <motion.p className="mt-2 text-center text-[11px]" style={{ color: "var(--muted)" }} variants={hop}>v{p.appVersion}</motion.p>
      </div>
    </motion.div>
  );
}
