import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import * as spApi from "@/api/supplierPortalApi";
import {
  RefreshCw,
  FileSpreadsheet,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  InboxIcon,
  CalendarDays,
  Package,
  Building2,
  ListChecks,
  Phone,
  Mail,
  MapPin,
  User,
  ArrowRight,
  Sparkles,
} from "lucide-react";

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const isOverdue = (due?: string | null) => !!due && new Date(due) < new Date();
const isDueSoon = (due?: string | null) =>
  !!due && !isOverdue(due) && new Date(due) <= new Date(Date.now() + 3 * 86400_000);

export default function SupplierDashboard() {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const uid = currentUser?.id ?? "";

  const { data: quotations = [], isLoading: loadingQ } = useQuery({
    queryKey: ["supplier-quotations"],
    queryFn: spApi.getSupplierQuotations,
  });
  const { data: profile } = useQuery({
    queryKey: ["supplier-profile"],
    queryFn: spApi.getSupplierProfile,
    staleTime: 5 * 60_000,
  });
  const { data: catalog = [] } = useQuery({
    queryKey: ["supplier-catalog"],
    queryFn: spApi.getSupplierCatalog,
    staleTime: 5 * 60_000,
  });

  const pending = quotations.filter((q) => q.MySubmissionStatus === "Pending");
  const submitted = quotations.filter((q) => q.MySubmissionStatus === "Submitted");
  const overdue = pending.filter((q) => isOverdue(q.DueDate));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (currentUser?.name ?? "Supplier").split(" ")[0];
  const initials = currentUser?.initials || firstName.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl mb-6"
          style={isDark ? {
            background: "linear-gradient(135deg, #064e3b 0%, #065f46 40%, #047857 70%, #059669 100%)",
            boxShadow: "0 8px 32px rgba(5,150,105,0.30)",
          } : {
            background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #a7f3d0 100%)",
            border: "1px solid #6ee7b7",
            boxShadow: "0 4px 24px rgba(16,185,129,0.12)",
          }}>
          {/* Dot grid overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `radial-gradient(circle, ${isDark ? "rgba(255,255,255,0.10)" : "rgba(5,150,105,0.12)"} 1px, transparent 1px)`,
            backgroundSize: "22px 22px",
          }} />
          {/* Glow blob */}
          <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full pointer-events-none" style={{
            background: `radial-gradient(circle, ${isDark ? "rgba(16,185,129,0.35)" : "rgba(16,185,129,0.20)"} 0%, transparent 70%)`,
            filter: "blur(40px)",
          }} />

          <div className="relative flex items-center gap-5 px-7 py-6">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold"
                style={isDark
                  ? { background: "rgba(255,255,255,0.18)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.25)", color: "#064e3b" }
                  : { background: "rgba(255,255,255,0.70)", backdropFilter: "blur(8px)", border: "1px solid rgba(16,185,129,0.35)", color: "#064e3b" }}>
                {initials}
              </div>
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                style={{ background: isDark ? "#34d399" : "#10b981", borderColor: isDark ? "#065f46" : "#d1fae5" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: isDark ? "#064e3b" : "#fff" }} />
              </span>
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium mb-0.5 flex items-center gap-1.5"
                style={{ color: isDark ? "rgba(167,243,208,0.8)" : "#059669" }}>
                <Sparkles size={11} /> {greeting}
              </p>
              <h1 className="text-2xl font-bold leading-tight"
                style={{ color: isDark ? "#fff" : "#064e3b" }}>{firstName}</h1>
              <p className="text-sm mt-1"
                style={{ color: isDark ? "rgba(209,250,229,0.60)" : "#047857" }}>
                {pending.length > 0
                  ? `${pending.length} pending RFQ${pending.length > 1 ? "s" : ""} waiting for your rates.`
                  : overdue.length > 0
                  ? `${overdue.length} overdue RFQ${overdue.length > 1 ? "s" : ""} — please submit your rates.`
                  : "You're all caught up — no pending quotations right now."}
              </p>
            </div>

            {/* Stat chips */}
            <div className="hidden md:flex items-center gap-3 shrink-0">
              {[
                { label: "Total RFQs", value: quotations.length, valCol: isDark ? "#fff" : "#064e3b" },
                { label: "Pending", value: pending.length, valCol: pending.length > 0 ? (isDark ? "#fcd34d" : "#b45309") : (isDark ? "rgba(255,255,255,0.5)" : "#047857") },
                { label: "Submitted", value: submitted.length, valCol: isDark ? "#6ee7b7" : "#065f46" },
              ].map((s) => (
                <div key={s.label} className="text-center px-4 py-2.5 rounded-xl"
                  style={isDark
                    ? { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }
                    : { background: "rgba(255,255,255,0.55)", border: "1px solid rgba(16,185,129,0.25)" }}>
                  <p className="text-xl font-bold leading-none" style={{ color: s.valCol }}>{s.value}</p>
                  <p className="text-[10px] mt-1 font-medium" style={{ color: isDark ? "rgba(255,255,255,0.40)" : "#059669" }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile stat row */}
        <div className="grid grid-cols-3 gap-3 mb-6 md:hidden">
          {[
            { label: "Total", value: quotations.length, cls: "" },
            { label: "Pending", value: pending.length, cls: pending.length > 0 ? "text-amber-500" : "" },
            { label: "Submitted", value: submitted.length, cls: "text-emerald-600" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-2">
              <div><p className={`text-lg font-bold ${s.cls}`}>{s.value}</p><p className="text-[10px] text-muted-foreground">{s.label}</p></div>
            </div>
          ))}
        </div>

        {/* ── Two-column layout ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left: quotations (2/3) */}
          <div className="lg:col-span-2 space-y-5">

            {loadingQ && (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm gap-2">
                <RefreshCw size={15} className="animate-spin" /> Loading quotations…
              </div>
            )}

            {!loadingQ && quotations.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3 rounded-xl border border-dashed border-border">
                <InboxIcon size={28} className="text-muted-foreground/30" />
                <div>
                  <p className="font-semibold text-sm">No quotations yet</p>
                  <p className="text-xs text-muted-foreground mt-1">RFQs sent to you will appear here.</p>
                </div>
              </div>
            )}

            {pending.length > 0 && (
              <Section title="Awaiting your response" count={pending.length} accent="amber">
                {pending.map((q) => <QuotationCard key={q.QuotationId} q={q} uid={uid} />)}
              </Section>
            )}

            {submitted.length > 0 && (
              <Section title="Already submitted" count={submitted.length}>
                {submitted.map((q) => <QuotationCard key={q.QuotationId} q={q} uid={uid} />)}
              </Section>
            )}
          </div>

          {/* Right sidebar (1/3) */}
          <div className="space-y-4">

            {/* Company card */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="h-14 relative"
                style={isDark
                  ? { background: "linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)" }
                  : { background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", borderBottom: "1px solid #a7f3d0" }}>
                <div className="absolute inset-0" style={{
                  backgroundImage: `radial-gradient(circle, ${isDark ? "rgba(255,255,255,0.10)" : "rgba(5,150,105,0.10)"} 1px, transparent 1px)`,
                  backgroundSize: "14px 14px",
                }} />
              </div>
              <div className="px-4 pb-4 -mt-7">
                <div className="w-14 h-14 rounded-xl border-2 border-card bg-emerald-500/10 flex items-center justify-center mb-3"
                  style={{ boxShadow: "0 2px 12px rgba(16,185,129,0.18)" }}>
                  <Building2 size={22} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="font-bold text-sm text-foreground leading-snug">
                  {profile?.Name ?? currentUser?.name ?? "—"}
                </p>
                {profile?.LHeadCode && (
                  <p className="text-xs text-muted-foreground mt-0.5">#{profile.LHeadCode}</p>
                )}
                <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                  {profile?.LHeadContactPerson && <InfoRow icon={User} value={profile.LHeadContactPerson} />}
                  {profile?.LHeadPhone && <InfoRow icon={Phone} value={profile.LHeadPhone} />}
                  {profile?.LHeadEmail && <InfoRow icon={Mail} value={profile.LHeadEmail} />}
                  {profile?.LHeadAddress && <InfoRow icon={MapPin} value={profile.LHeadAddress} />}
                </div>
              </div>
            </div>

            {/* Price catalog card */}
            <Link to={`/supplier-portal/${uid}/catalog`}>
              <div className="rounded-xl border border-border bg-card p-4 hover:border-emerald-500/40 hover:shadow-sm transition-all group">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <ListChecks size={15} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <span className="text-sm font-semibold">Price Catalog</span>
                  </div>
                  <ArrowRight size={14} className="text-muted-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                </div>
                <p className="text-2xl font-bold">{catalog.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {catalog.length === 0 ? "No items in your catalog yet" : `item${catalog.length !== 1 ? "s" : ""} in your catalog`}
                </p>
              </div>
            </Link>

            {/* Quick tips */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quick guide</p>
              {[
                { step: "1", text: "Open a pending RFQ and enter your rates for each item." },
                { step: "2", text: "Add supply date and quality notes to stand out." },
                { step: "3", text: "Submit before the due date — the buyer sees your prices in the L1 chart." },
              ].map((tip) => (
                <div key={tip.step} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {tip.step}
                  </span>
                  <p className="text-xs text-muted-foreground leading-relaxed">{tip.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────
function InfoRow({ icon: Icon, value }: { icon: React.ElementType; value: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <Icon size={12} className="mt-0.5 shrink-0" />
      <span className="break-all">{value}</span>
    </div>
  );
}

function Section({ title, count, accent = "default", children }: {
  title: string; count: number; accent?: "amber" | "default"; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`text-[10px] font-bold uppercase tracking-widest ${accent === "amber" ? "text-amber-500" : "text-muted-foreground"}`}>
          {title}
        </span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${accent === "amber" ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"}`}>
          {count}
        </span>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function QuotationCard({ q, uid }: { q: spApi.SupplierQuotationSummary; uid: string }) {
  const sub = q.MySubmissionStatus === "Submitted";
  const od = isOverdue(q.DueDate);
  const soon = isDueSoon(q.DueDate);
  const urgent = !sub && (od || soon);

  return (
    <Link to={`/supplier-portal/${uid}/quotation/${q.QuotationId}`}>
      <div className={`group rounded-xl border bg-card transition-all hover:shadow-md ${
        urgent ? "border-amber-500/30 hover:border-amber-500/50"
        : sub ? "border-emerald-500/25 hover:border-emerald-500/40"
        : "border-border hover:border-border/80"
      }`}>
        <div className="p-4 flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            urgent ? "bg-amber-500/10" : sub ? "bg-emerald-500/10" : "bg-muted/60"
          }`}>
            <FileSpreadsheet size={16} className={urgent ? "text-amber-500" : sub ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
              <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">{q.DocNo}</span>
              {sub ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                  <CheckCircle2 size={9} /> Submitted
                </span>
              ) : od ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                  <AlertCircle size={9} /> Overdue
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                  <Clock size={9} /> Pending
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {q.CompanyName && <span className="flex items-center gap-1"><Building2 size={10} />{q.CompanyName}</span>}
              {q.ProjectName && <span>{q.ProjectName}</span>}
              <span className="flex items-center gap-1"><Package size={10} />{q.ItemCount} item{q.ItemCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className={`text-xs flex items-center gap-1 justify-end ${od ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
              <CalendarDays size={10} />
              {q.DueDate ? fmtDate(q.DueDate) : "No due date"}
            </p>
            {!sub && (
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5 font-medium group-hover:underline">
                Submit rates →
              </p>
            )}
          </div>
          <ChevronRight size={14} className="text-muted-foreground shrink-0" />
        </div>
        {urgent && <div className={`h-0.5 rounded-b-xl ${od ? "bg-red-500/40" : "bg-amber-500/30"}`} />}
      </div>
    </Link>
  );
}
