import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Global, MessageQuestion, Timer1, PauseCircle, ShieldTick, TickCircle, Judge, Map1, Grid5, DocumentText, Building4, Profile2User, Link21, Note1, Chart, MoneySend } from "iconsax-react";
import { ArrowRight, ChevronRight, CheckCircle2, CircleAlert, ExternalLink, Search, Trash2, AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { LegalShell, LEGAL_ACCENT as ACCENT, LEGAL_GRADIENT } from "@/components/legal/LegalShell";
import { getLegalSummary } from "@/api/legalMastersApi";
import { getLandStats, deleteLand, type LandSummaryItem } from "@/api/legalLandApi";
import { LEGAL_MASTERS, LEGAL_MASTER_GROUPS, legalMasterPath } from "./legalMasters";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// What has to be in place before a deed registration task can run end to end (search → deed → L1 → L2).
const READINESS: { key: string; label: string; hint: string }[] = [
  { key: "registration-office", label: "Registration offices", hint: "Add the ADSR / DSR offices you register at" },
  { key: "portal-link", label: "Official portal links", hint: "Add the verified search / certified-copy links" },
  { key: "deed-type", label: "Deed types", hint: "Classify deeds (sale, gift, POA…)" },
  { key: "checklist-item", label: "Document checklist", hint: "Review the starting checklist and approve it" },
  { key: "approval-workflow", label: "L1 / L2 approval workflow", hint: "Pick the reviewer and approver roles" },
  { key: "task-type", label: "Registration task type", hint: "Tie deed type, checklist and workflow together" },
  { key: "mouza", label: "Land records (Mouza)", hint: "Add the Mouzas your land parcels sit in" },
];

const fmtDate = (d: string | null) =>
  d ? new Date(d.slice(0, 10)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Never tested";

const PARTY_KEYS = ["owner", "seller", "buyer", "customer", "witness"] as const;

export default function LegalDashboard() {
  usePageRights("legal-dashboard");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-summary"], queryFn: getLegalSummary, staleTime: 60 * 1000 });
  const landRights = usePageRights("legal-land-master");
  const { data: land } = useQuery({ queryKey: ["legal-land-stats"], queryFn: getLandStats, staleTime: 60 * 1000, enabled: landRights.canView });

  const [landSearch, setLandSearch] = useState("");
  const [landToDelete, setLandToDelete] = useState<LandSummaryItem | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (l: LandSummaryItem) => deleteLand(l.LandId, l.LandCode),
    onSuccess: (res) => {
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ["legal-land-stats"] });
      queryClient.invalidateQueries({ queryKey: ["legal-summary"] });
      setLandToDelete(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not delete land");
    },
  });

  const filteredLands = useMemo(() => {
    const list = land?.allLands || [];
    if (!landSearch.trim()) return list;
    const q = landSearch.toLowerCase();
    return list.filter(
      (l) =>
        l.LandCode?.toLowerCase().includes(q) ||
        l.LandName?.toLowerCase().includes(q) ||
        l.MouzaName?.toLowerCase().includes(q) ||
        l.DistrictName?.toLowerCase().includes(q)
    );
  }, [land?.allLands, landSearch]);

  // Counts are of active records, which is what each table shows first (its Active tab).
  const active = (key: string) => data?.masters[key]?.active ?? 0;
  const dash = (n: number) => (isLoading ? "—" : n);
  const readiness = useMemo(() => READINESS.map((r) => ({ ...r, done: (data?.masters[r.key]?.active ?? 0) > 0 })), [data]);
  const ready = readiness.filter((r) => r.done).length;
  const firstGap = readiness.find((r) => !r.done);
  const plotsWithoutRor = (data?.mouzas ?? []).reduce((n, m) => n + m.PlotsWithoutRor, 0);

  const card = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";
  const eyebrow = "mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground";

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal" }]} />
      <LegalShell title="Company Land Records" subtitle="Centralized property registers, ownership history, and document archive" icon={Judge}>
        <div className="space-y-5">
          {error && <div className={`${card} p-4 text-sm text-destructive`}>Could not load the Legal summary: {(error as Error).message}</div>}

          {/* ── Hero ── */}
          <div className="border border-border p-4 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div className="min-w-0">
                <p className="label">Company Land Portfolio</p>
                <h2 className="mt-1 text-2xl sm:text-3xl font-heading font-bold leading-tight text-foreground">
                  {land?.totalLands ?? 0} Properties Registered
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Central digital record book for all company-owned properties, historical owners, and land records.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate("/legal/land/properties")}
                  className="inline-flex items-center gap-1.5 border border-foreground bg-card px-3.5 py-2.5 text-xs font-heading font-semibold uppercase tracking-[0.1em] text-foreground hover:bg-primary/10"
                >
                  Register Existing Land
                </button>
                <button
                  onClick={() => navigate("/legal/land/properties")}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-heading font-semibold uppercase tracking-[0.1em] text-card hover:opacity-85"
                  style={{ background: LEGAL_GRADIENT }}
                >
                  Open Land Register <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* ── Land Portfolio Quick Access ── */}
          {land && (
            <div className={`${card} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={eyebrow}>Land Portfolio Overview</p>
                <button onClick={() => navigate("/legal/land/properties")} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  All land properties <ChevronRight size={13} />
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                {([
                  ["All Properties", land.totalLands, Global, "/legal/land/properties"],
                  ["Active Enquiries", land.activeEnquiries ?? 0, MessageQuestion, "/legal/land/enquiries"],
                  ["Newly Acquired", land.totalLands - (land.backlogLands ?? 0), TickCircle, "/legal/land/properties?filter=newly-acquired"],
                  ["Existing / Backlog", land.backlogLands ?? 0, Building4, "/legal/land/properties?filter=backlog"],
                  ["Land Sales", land.completed ?? 0, MoneySend, "/legal/land/sales"],
                  ["RS Records", land.totalLands, Note1, "/legal/land/rs-register"],
                  ["LR Records of Rights", land.totalLands, DocumentText, "/legal/land/lr-register"],
                  ["Land Reports", "8 Reports", Chart, "/legal/land/reports"],
                ] as const).map(([label, value, Icon, path]) => (
                  <button key={label} onClick={() => navigate(path)} className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 text-left transition-transform hover:-translate-y-0.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-card" style={{ background: LEGAL_GRADIENT }}><Icon size={16} /></span>
                    <span className="min-w-0">
                      <span className="block text-xl font-heading font-bold tabular-nums leading-none text-foreground">{value}</span>
                      <span className="mt-1 block text-[0.6875rem] leading-tight text-muted-foreground line-clamp-2 sm:truncate">{label}</span>
                    </span>
                  </button>
                ))}
              </div>
              {land.recent.length > 0 && (
                <div className="mt-4 divide-y divide-border/60">
                  {land.recent.map((l) => (
                    <button key={l.LandId} onClick={() => navigate(`/legal/land/properties/${l.LandId}`)} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-muted/40 rounded-md px-1.5">
                      <span className="font-mono text-xs text-muted-foreground w-28 shrink-0">{l.LandCode}</span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{l.LandName}{l.MouzaName ? <span className="text-muted-foreground"> · {l.MouzaName} (J.L. {l.JLNo ?? "-"})</span> : null}</span>
                      <span className="hidden sm:inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] border-border text-muted-foreground">
                        {l.WorkflowStatus ?? "Active"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── ALL REGISTERED COMPANY LANDS TABLE ── */}
          <div className={`${card} p-4 sm:p-5`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-heading font-bold text-foreground">All Registered Company Lands</h3>
                <p className="text-xs text-muted-foreground">
                  Complete register of all company-owned properties with verification, approval status, and management controls.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={landSearch}
                    onChange={(e) => setLandSearch(e.target.value)}
                    placeholder="Search by code, title, mouza..."
                    className="h-8 rounded-lg border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48 sm:w-64"
                  />
                </div>
                <button
                  onClick={() => navigate("/legal/land/properties")}
                  className="h-8 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
                >
                  + Add Land
                </button>
              </div>
            </div>

            {(!land?.allLands || land.allLands.length === 0) ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                No lands recorded yet. Click "Add Land" or "Register Existing Land" to add your first property.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/40 border-y border-border/60 text-[0.6875rem] font-heading uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5">Land ID</th>
                      <th className="px-3 py-2.5">Property Title</th>
                      <th className="px-3 py-2.5">Mouza & District</th>
                      <th className="px-3 py-2.5">Area</th>
                      <th className="px-3 py-2.5">Entry Type</th>
                      <th className="px-3 py-2.5">Verification</th>
                      <th className="px-3 py-2.5">L1 Legal</th>
                      <th className="px-3 py-2.5">L2 Approval</th>
                      <th className="px-3 py-2.5">Land Status</th>
                      <th className="px-3 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredLands.map((item) => (
                      <tr key={item.LandId} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2.5 font-mono font-semibold text-primary">
                          <button
                            onClick={() => navigate(`/legal/land/properties/${item.LandId}`)}
                            className="hover:underline flex items-center gap-1"
                          >
                            {item.LandCode}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-foreground">
                          <button
                            onClick={() => navigate(`/legal/land/properties/${item.LandId}`)}
                            className="hover:underline text-left"
                          >
                            {item.LandName}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {item.MouzaName ? `${item.MouzaName}${item.JLNo ? ` (J.L. ${item.JLNo})` : ""}` : "—"}
                          {item.DistrictName ? ` · ${item.DistrictName}` : ""}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-foreground whitespace-nowrap">
                          {item.Area !== null ? `${item.Area} ${item.UnitName ?? ""}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {item.EntryType ?? "Newly Acquired"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold border ${
                              item.VerificationStatus === "Verified"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : item.VerificationStatus === "Rejected"
                                ? "bg-red-500/10 text-red-600 border-red-500/20"
                                : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                            }`}
                          >
                            {item.VerificationStatus ?? "Draft"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold border ${
                              item.L1Status === "Approved"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : item.L1Status === "Returned"
                                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                : "bg-blue-500/10 text-blue-600 border-blue-500/20"
                            }`}
                          >
                            {item.L1Status ?? "Pending"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-semibold border ${
                              item.L2Status === "Approved"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : item.L2Status === "Returned"
                                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                : item.L2Status === "Rejected"
                                ? "bg-red-500/10 text-red-600 border-red-500/20"
                                : "bg-purple-500/10 text-purple-600 border-purple-500/20"
                            }`}
                          >
                            {item.L2Status ?? "Pending"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] border border-border text-foreground">
                            {item.LandStatus ?? "Owned"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => navigate(`/legal/land/properties/${item.LandId}`)}
                              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.6875rem] font-medium text-foreground hover:bg-muted"
                              title="View full land profile"
                            >
                              <Eye size={12} /> View
                            </button>
                            {landRights.canDelete && (
                              <button
                                onClick={() => setLandToDelete(item)}
                                className="inline-flex items-center gap-1 rounded border border-destructive/30 px-2 py-1 text-[0.6875rem] font-medium text-destructive hover:bg-destructive/10"
                                title="Delete land and all related records"
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Land Management work lists ── */}
          {land && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {([
                ["Waiting for a reviewer", land.approvals.map((a) => ({ k: a.Kind, main: a.Kind, side: String(a.N), land: null as number | null })), "Nothing to review"],
                ["Upcoming registration appointments", land.appointments.map((a, i) => ({ k: String(i), main: `${a.LandCode} · ${a.OfficeName ?? ""}`, side: `${fmtDate(a.AppointmentDate)} ${a.AppointmentTime ?? ""}`, land: a.LandId })), "None scheduled"],
                ["Payments awaiting verification", land.payments.map((p, i) => ({ k: String(i), main: `${p.LandCode} · ${p.TransactionRef ?? ""}`, side: `₹${Number(p.Amount).toLocaleString("en-IN")}`, land: p.LandId })), "None pending"],
                ["Open legal cases & disputes", land.cases.map((c) => ({ k: c.CaseNumber, main: `${c.LandCode} · ${c.CaseNumber}`, side: c.NextHearingDate ? `Hearing ${fmtDate(c.NextHearingDate)}` : c.Status, land: c.LandId })), "No open cases"],
                ["Recent ownership transfers", land.transfers.map((t, i) => ({ k: String(i), main: `${t.LandCode} · ${t.FromName} → ${t.ToName}`, side: fmtDate(t.EventDate), land: t.LandId })), "No transfers yet"],
              ] as const).map(([title, items, empty]) => (
                <div key={title} className={`${card} p-4`}>
                  <p className={eyebrow}>{title}</p>
                  {!items.length ? <p className="text-sm text-muted-foreground">{empty}</p> : (
                    <ul className="space-y-1">
                      {items.map((it) => (
                        <li key={it.k}>
                          <button disabled={!it.land} onClick={() => it.land && navigate(`/legal/land/properties/${it.land}`)}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/40 disabled:hover:bg-transparent">
                            <span className="min-w-0 break-words text-foreground sm:truncate">{it.main}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{it.side}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Stats ── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {([
              ["Mouzas", active("mouza"), Map1, "mouza"],
              ["RS plots", active("rs-plot"), Grid5, "rs-plot"],
              ["LR RoR records", active("lr-ror"), DocumentText, "lr-ror"],
              ["Registration offices", active("registration-office"), Building4, "registration-office"],
              // All party types together; the tile opens the first type that has anyone in it.
              ["Parties", PARTY_KEYS.reduce((n, k) => n + active(k), 0), Profile2User, PARTY_KEYS.find((k) => active(k) > 0) ?? "owner"],
            ] as const).map(([label, value, Icon, key]) => (
              <button key={label} onClick={() => navigate(legalMasterPath(key))} className={`${card} p-4 flex items-center gap-3 text-left transition-transform hover:-translate-y-0.5`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-card shadow-sm" style={{ background: LEGAL_GRADIENT }}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-2xl font-heading font-bold tabular-nums leading-none text-foreground">{dash(value)}</span>
                  <span className="mt-1 block text-[0.6875rem] leading-tight text-muted-foreground line-clamp-2 sm:truncate">{label}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5">
            <div className="space-y-5 min-w-0">
              {/* ── Land records by Mouza ── */}
              <div className={`${card} p-4 sm:p-5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={eyebrow}>Land records by Mouza</p>
                  {plotsWithoutRor > 0 && (
                    <span className="mb-3 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] text-amber-600 border-amber-500/40 bg-amber-500/10">
                      <CircleAlert size={12} /> {plotsWithoutRor} RS {plotsWithoutRor === 1 ? "plot has" : "plots have"} no LR RoR yet
                    </span>
                  )}
                </div>
                {isLoading ? (
                  <div className="space-y-2">{[0, 1, 2].map((k) => <div key={k} className="h-9 rounded-lg bg-muted/60 animate-pulse" />)}</div>
                ) : !data?.mouzas.length ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No Mouza added yet — start with the Mouza master, then its RS Khatians and plots.</p>
                ) : (
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead>
                        <tr className="text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                          <th className="px-1 py-1.5 font-medium">Mouza</th>
                          <th className="px-1 py-1.5 font-medium">District</th>
                          <th className="px-1 py-1.5 font-medium text-right">RS Khatian</th>
                          <th className="px-1 py-1.5 font-medium text-right">RS plots</th>
                          <th className="px-1 py-1.5 font-medium text-right">LR RoR</th>
                          <th className="px-1 py-1.5 font-medium text-right">Plots w/o RoR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.mouzas.slice(0, 10).map((m) => (
                          <tr key={m.MouzaId} className="border-t border-border/60">
                            <td className="px-1 py-2 font-medium text-foreground">{m.MouzaName} <span className="text-xs text-muted-foreground">J.L. {m.JLNo}</span></td>
                            <td className="px-1 py-2 text-muted-foreground">{m.District}</td>
                            <td className="px-1 py-2 text-right tabular-nums">{m.RsKhatians}</td>
                            <td className="px-1 py-2 text-right tabular-nums">{m.RsPlots}</td>
                            <td className="px-1 py-2 text-right tabular-nums">{m.LrRors}</td>
                            <td className={`px-1 py-2 text-right tabular-nums ${m.PlotsWithoutRor ? "text-amber-600 font-semibold" : "text-muted-foreground"}`}>{m.PlotsWithoutRor}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data.mouzas.length > 10 && <p className="mt-2 text-[0.6875rem] text-muted-foreground">+{data.mouzas.length - 10} more Mouzas</p>}
                  </div>
                )}
              </div>

              {/* ── Every master, grouped like the Setup menu ── */}
              {LEGAL_MASTER_GROUPS.map((g) => (
                <div key={g} className={`${card} p-4 sm:p-5`}>
                  <p className={eyebrow}>{g}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {LEGAL_MASTERS.filter((m) => m.group === g).map((it) => (
                      <button
                        key={it.key}
                        onClick={() => navigate(legalMasterPath(it.key))}
                        className="group flex items-center gap-3 rounded-xl border border-border/70 bg-background/40 p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${ACCENT} 10%, transparent)`, color: ACCENT }}>
                          <it.icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-foreground truncate">{it.label}</span>
                          <span className="block text-xs text-muted-foreground truncate">{it.desc}</span>
                        </span>
                        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] tabular-nums text-muted-foreground">{dash(active(it.key))}</span>
                        <ChevronRight size={15} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-5 min-w-0">
              {/* ── Setup readiness ── */}
              <div className={`${card} p-4 sm:p-5`}>
                <p className={eyebrow}>Ready for deed registration</p>
                <ul className="space-y-1">
                  {readiness.map((r) => (
                    <li key={r.key}>
                      <button onClick={() => navigate(legalMasterPath(r.key))} className="flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-muted/50">
                        {r.done
                          ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                          : <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />}
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">{r.label}</span>
                          {!r.done && !isLoading && <span className="block text-xs text-muted-foreground">{r.hint}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* ── Checklist templates ── */}
              <div className={`${card} p-4 sm:p-5`}>
                <p className={eyebrow}>Checklist templates</p>
                {!data?.templates.length ? (
                  <p className="py-3 text-xs text-muted-foreground">{isLoading ? "Loading…" : "No active checklist template."}</p>
                ) : (
                  <ul className="space-y-2">
                    {data.templates.map((t) => (
                      <li key={t.TemplateId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-foreground">{t.TemplateName} <span className="text-xs text-muted-foreground">v{t.VersionNo}</span></span>
                        <span className={`shrink-0 text-xs tabular-nums ${t.Items ? "text-muted-foreground" : "text-amber-600"}`}>{t.Items} docs · {t.RequiredItems} required</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* ── Portal links due for a check ── */}
              <div className={`${card} p-4 sm:p-5`}>
                <p className={eyebrow}>Portal links to re-check</p>
                {!data?.staleLinks.length ? (
                  <p className="py-3 text-xs text-muted-foreground">
                    {isLoading ? "Loading…" : active("portal-link") ? `Every active link was tested in the last ${data?.staleLinkDays} days.` : "No portal links added yet."}
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {data.staleLinks.slice(0, 6).map((l) => (
                      <li key={l.LinkId} className="flex items-start gap-2.5">
                        <Link21 size={16} className="mt-0.5 shrink-0" style={{ color: ACCENT }} />
                        <span className="min-w-0 flex-1">
                          <a href={l.Url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm font-medium text-foreground hover:underline">
                            <span className="truncate">{l.LinkLabel}</span> <ExternalLink size={12} className="shrink-0" />
                          </a>
                          <span className="block text-xs text-muted-foreground truncate">{l.ServiceType}{l.OfficeName ? ` · ${l.OfficeName}` : ""} · {fmtDate(l.LastTestedDate)}</span>
                        </span>
                      </li>
                    ))}
                    {data.staleLinks.length > 6 && <li className="text-[0.6875rem] text-muted-foreground">+{data.staleLinks.length - 6} more</li>}
                  </ul>
                )}
                <p className="mt-3 text-[0.6875rem] leading-relaxed text-muted-foreground">
                  Opening a link is not an automated government search — the outcome is recorded by the person who searched.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Modal: Permanent Land Deletion */}
        <Dialog open={!!landToDelete} onOpenChange={() => setLandToDelete(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle size={18} /> Delete Land Property
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground pt-1">
                This action is permanent and cannot be reversed.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p>
                Are you sure you want to permanently delete property{" "}
                <b className="text-foreground">{landToDelete?.LandCode}</b> (
                <span className="text-foreground">{landToDelete?.LandName}</span>)?
              </p>
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive space-y-1">
                <p className="font-semibold">All associated records will be permanently removed:</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[0.6875rem]">
                  <li>Ownership records & historical chain of transfers</li>
                  <li>RS and LR Record of Rights (Khatians & Dags)</li>
                  <li>Document archive & uploaded file attachments</li>
                  <li>Legal cases, disputes, mortgages, and court orders</li>
                  <li>Mutation records & certificate history</li>
                  <li>Payment records, transactions, and tax receipts</li>
                  <li>Audit trails & workflow state history</li>
                </ul>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLandToDelete(null)}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => landToDelete && deleteMutation.mutate(landToDelete)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Permanently Delete Land"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </LegalShell>
    </>
  );
}
