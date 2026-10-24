// Right of the sign-in page: the building (a cut-out, public/login-photo.webp) standing at the foot of a soft sky in a
// panel with notched corners, with the line and the company's figures in the sky above it. The building rises into
// place, clouds drift across the sky and the figures pop in and count up.
import React, { useEffect, useState } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { LOGIN_PHOTO, type PublicStats } from "./config";
import { FLOW, cascade, pop } from "./motion";

const num = (n: number) => Math.round(n).toLocaleString("en-IN");

/** A figure that counts up from 0 when it first appears. */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const still = useReducedMotion();
  const [v, setV] = useState(still ? to : 0);
  useEffect(() => {
    if (still) { setV(to); return; }
    const c = animate(0, to, { duration: 1.4, delay: 0.7, ease: [0.16, 1, 0.3, 1], onUpdate: setV });
    return () => c.stop();
  }, [to, still]);
  return <>{num(v)}{suffix}</>;
}

const SKY = "linear-gradient(180deg, #cfdfe6 0%, #e6ebe6 38%, #f3e8da 72%, #ead7c0 100%)";

/** Below the wide layout the photo panel is hidden; the same sky, clouds and building fill the screen behind the form. */
export function LoginBackdrop() {
  const [hasPhoto, setHasPhoto] = useState(true);
  return (
    <div className="ls-backdrop lg:hidden fixed inset-0 z-0 overflow-hidden" style={{ background: SKY }} aria-hidden>
      <div className="absolute inset-0 ls-sun" style={{ background: "radial-gradient(70% 35% at 65% 85%, rgba(255,214,160,0.6), transparent 70%)" }} />
      <span className="ls-cloud" style={{ top: "8%", width: 200, height: 50, animationDuration: "30s", animationDelay: "-4s" }} />
      <span className="ls-cloud" style={{ top: "18%", width: 130, height: 34, animationDuration: "44s", animationDelay: "-26s", opacity: 0.7 }} />
      {hasPhoto && (
        <motion.img
          src={LOGIN_PHOTO}
          alt=""
          onError={() => setHasPhoto(false)}
          className="absolute select-none pointer-events-none"
          style={{ left: "50%", bottom: 0, width: "max(230%, 900px)", maxWidth: "none", x: "-50%" }}
          initial={{ y: "15%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 70, damping: 14, mass: 1.1, delay: 0.2 }}
          draggable={false}
        />
      )}
    </div>
  );
}

export function LoginPhoto({ stats }: { stats: PublicStats | null }) {
  const [hasPhoto, setHasPhoto] = useState(true);
  const figures: [number, string, string][] = stats
    ? [
        [stats.projects ?? 0, "", "Projects"],
        [stats.activeSuppliers ?? 0, "", "Suppliers"],
        [stats.workOrders ?? 0, "", "Work orders"],
        [Math.min(100, Math.max(0, stats.workOrderCompletionPct ?? 0)), "%", "Work completed"],
      ]
    : [];

  return (
    <motion.div
      className="ls-photo h-full min-h-[520px]"
      style={{ background: SKY }}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...FLOW, delay: 0.1 }}
    >
      {/* A low sun behind the buildings, breathing slowly */}
      <div className="absolute inset-0 ls-sun" style={{ background: "radial-gradient(55% 40% at 70% 78%, rgba(255,214,160,0.55), transparent 70%)" }} />

      {/* Clouds drifting across the sky, behind the building */}
      <span className="ls-cloud" style={{ top: "30%", width: 220, height: 54, animationDuration: "38s", animationDelay: "-6s" }} />
      <span className="ls-cloud" style={{ top: "42%", width: 150, height: 38, animationDuration: "52s", animationDelay: "-30s", opacity: 0.7 }} />
      <span className="ls-cloud" style={{ top: "22%", width: 120, height: 30, animationDuration: "64s", animationDelay: "-48s", opacity: 0.55 }} />

      {hasPhoto && (
        <motion.img
          src={LOGIN_PHOTO}
          alt=""
          onError={() => setHasPhoto(false)}
          className="absolute select-none pointer-events-none"
          style={{ left: "46%", bottom: "-2%", width: "142%", maxWidth: "none", x: "-50%" }}
          initial={{ y: "18%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 70, damping: 14, mass: 1.1, delay: 0.25 }}
          draggable={false}
        />
      )}

      <span className="ls-bite tl" />
      <span className="ls-corner tl-a" />
      <span className="ls-corner tl-b" />
      <span className="ls-bite br" />
      <span className="ls-corner br-a" />
      <span className="ls-corner br-b" />

      {/* The line and the figures, in the sky to the right of the top notch */}
      <motion.div className="absolute z-[3] text-right" style={{ top: "6%", right: "6%", left: "40%" }} variants={cascade(0.35, 0.1)} initial="hidden" animate="show">
        <motion.p
          className="font-heading font-semibold"
          style={{ fontSize: "clamp(18px, 1.6vw, 25px)", lineHeight: 1.3, color: "#1d2a24", textWrap: "balance" }}
          variants={{ hidden: { opacity: 0, x: 30 }, show: { opacity: 1, x: 0, transition: FLOW } }}
        >
          Manage smarter, build better. Built for civil contractors.
        </motion.p>
        {figures.length > 0 && (
          <motion.div
            className="mt-5 inline-flex flex-wrap justify-end gap-x-6 gap-y-3 px-5 py-3.5 rounded-2xl"
            style={{ background: "rgba(248,244,236,0.6)", border: "1px solid rgba(252,250,245,0.85)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
            variants={cascade(0.15, 0.1)}
            initial="hidden"
            animate="show"
          >
            {figures.map(([v, suffix, label]) => (
              <motion.div key={label} className="text-left" variants={pop} whileHover={{ y: -4, transition: { type: "spring", stiffness: 400, damping: 12 } }}>
                <p className="font-heading font-semibold tabular-nums" style={{ fontSize: "clamp(18px, 1.4vw, 23px)", lineHeight: 1, color: "var(--brand)" }}>
                  <CountUp to={v} suffix={suffix} />
                </p>
                <p className="text-[11.5px] mt-1" style={{ color: "#55625b" }}>{label}</p>
              </motion.div>
            ))}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
