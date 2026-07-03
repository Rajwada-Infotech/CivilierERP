import React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import * as spApi from "@/api/supplierPortalApi";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Building2, Mail, Phone, MapPin, User, CreditCard,
  FileText, Globe, Hash, CheckCircle2, RefreshCw,
  Landmark, Tag,
} from "lucide-react";

const fade = (delay = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] },
});

function InfoRow({
  icon: Icon, label, value, mono = false, highlight = false,
}: {
  icon: React.ElementType; label: string; value?: string | null;
  mono?: boolean; highlight?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/40 last:border-0">
      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={13} className="text-emerald-500" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-0.5">{label}</p>
        <p className={`text-sm ${mono ? "font-mono font-semibold" : "font-medium"} ${highlight ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"} break-words`}>
          {value}
        </p>
      </div>
    </div>
  );
}

export default function SupplierCompanyProfile() {
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const { data: profile, isLoading } = useQuery({
    queryKey: ["supplier-profile"],
    queryFn: spApi.getSupplierProfile,
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <RefreshCw size={15} className="animate-spin" /> Loading profile…
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const initials = profile.Name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const isActive = !profile.LHeadStatus || profile.LHeadStatus === "Approved";

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      {/* Subtle bg glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div style={{
          position: "absolute", top: "-5%", left: "50%", transform: "translateX(-50%)",
          width: "60vw", height: "35vh",
          background: `radial-gradient(ellipse at 50% 0%, rgba(16,185,129,${isDark ? "0.07" : "0.04"}) 0%, transparent 70%)`,
        }} />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10 space-y-6">

        {/* ── Hero card ─────────────────────────────────────────────────── */}
        <motion.div {...fade(0)}
          className="relative overflow-hidden rounded-2xl"
          style={{
            background: isDark
              ? "linear-gradient(135deg, rgba(5,46,22,0.80) 0%, rgba(6,78,59,0.65) 60%, rgba(4,120,87,0.50) 100%)"
              : "linear-gradient(135deg, #064e3b 0%, #065f46 60%, #047857 100%)",
            boxShadow: isDark
              ? "0 8px 40px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)"
              : "0 8px 32px rgba(4,120,87,0.28), inset 0 1px 0 rgba(255,255,255,0.14)",
          }}
        >
          {/* Dot texture */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }} />
          {/* Glow */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(ellipse at 80% -10%, rgba(52,211,153,0.22) 0%, transparent 60%)",
          }} />

          <div className="relative px-7 py-7 flex items-center gap-5">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0 text-xl font-bold font-heading text-white shadow-inner">
              {initials}
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-300/60 mb-1">Supplier Company</div>
              <h1 className="font-heading text-xl font-extrabold text-white leading-tight truncate">
                {profile.Name}
              </h1>
              {profile.LHeadCode && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Hash size={10} className="text-emerald-300/60" />
                  <span className="font-mono text-xs text-emerald-200/70">{profile.LHeadCode}</span>
                </div>
              )}
            </div>

            {/* Status badge */}
            <div className="shrink-0">
              {isActive ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 bg-emerald-400/15 border border-emerald-400/25 px-3 py-1 rounded-full">
                  <CheckCircle2 size={11} /> Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-white/10 border border-white/20 px-3 py-1 rounded-full">
                  {profile.LHeadStatus}
                </span>
              )}
            </div>
          </div>

          {/* Description band */}
          {profile.LDescription && (
            <div className="relative px-7 pb-5 pt-0">
              <div className="h-px bg-white/[0.10] mb-4" />
              <p className="text-sm text-white/55 italic leading-relaxed">"{profile.LDescription}"</p>
            </div>
          )}
        </motion.div>

        {/* ── Info grid ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Contact details */}
          <motion.div {...fade(0.08)} className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-sm font-bold text-foreground mb-1 flex items-center gap-2">
              <User size={14} className="text-emerald-500" /> Contact Details
            </h2>
            <div className="mt-3 space-y-0">
              <InfoRow icon={User} label="Contact Person" value={profile.LHeadContactPerson} />
              <InfoRow icon={Mail} label="Email" value={profile.LHeadEmail} />
              <InfoRow icon={Phone} label="Phone" value={profile.LHeadPhone} />
              <InfoRow icon={MapPin} label="Address" value={profile.LHeadAddress} />
              {profile.LCountry && (
                <InfoRow icon={Globe} label="Country" value={profile.LCountry} />
              )}
            </div>
          </motion.div>

          {/* Financial / compliance */}
          <motion.div {...fade(0.12)} className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-heading text-sm font-bold text-foreground mb-1 flex items-center gap-2">
              <Landmark size={14} className="text-emerald-500" /> Financial Info
            </h2>
            <div className="mt-3 space-y-0">
              <InfoRow icon={CreditCard} label="GST Number" value={profile.LGST} mono highlight />
              <InfoRow icon={MapPin} label="GST State" value={profile.LGSTState} />
              <InfoRow icon={FileText} label="Payment Terms" value={profile.LHeadPaymentTerms} />
              <InfoRow icon={Tag} label="Belongs To" value={profile.LBelongsTo} />
              <InfoRow icon={Hash} label="Supplier Code" value={profile.LHeadCode} mono />
            </div>
          </motion.div>
        </div>

        {/* ── Disclaimer ────────────────────────────────────────────────── */}
        <motion.p {...fade(0.18)} className="text-center text-xs text-muted-foreground/50 pb-2">
          To update company details, contact your procurement team.
        </motion.p>
      </div>
    </div>
  );
}
