import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Global, MessageQuestion, Timer1, PauseCircle, ShieldTick, TickCircle, Judge, Map1, Grid5, DocumentText, Building4, Profile2User, Link21 } from "iconsax-react";
import { ArrowRight, ChevronRight, CheckCircle2, CircleAlert, ExternalLink } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { LegalShell, LEGAL_ACCENT as ACCENT, LEGAL_GRADIENT } from "@/components/legal/LegalShell";
import { getLegalSummary } from "@/api/legalMastersApi";
import { getLandStats } from "@/api/legalLandApi";
import { LEGAL_MASTERS, LEGAL_MASTER_GROUPS, legalMasterPath } from "./legalMasters";

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

export default function LegalDashboard() {
  usePageRights("legal-dashboard");
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-summary"], queryFn: getLegalSummary, staleTime: 60 * 1000 });
  const landRights = usePageRights("legal-land-master");
  const { data: land } = useQuery({ queryKey: ["legal-land-stats"], queryFn: getLandStats, staleTime: 60 * 1000, enabled: landRights.canView });

  const active = (key: string) => data?.masters[key]?.active ?? 0;
  const dash = (n: number) => (isLoading ? "—" : n);
  const readiness = useMemo(() => READINESS.map((r) => ({ ...r, done: (data?.masters[r.key]?.active ?? 0) > 0 })), [data]);
  const ready = readiness.filter((r) => r.done).length;
  const firstGap = readiness.find((r) => !r.done);
  const plotsWithoutRor = (data?.mouzas ?? []).reduce((n, m) => n + m.PlotsWithoutRor, 0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const card = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";
  const eyebrow = "mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground";

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal" }]} />
      <LegalShell title="Legal" subtitle="Land records, deed registration & approvals" icon={Judge}>
        <div className="space-y-5">
          {error && <div className={`${card} p-4 text-sm text-destructive`}>Could not load the Legal summary: {(error as Error).message}</div>}

          {/* ── Hero ── */}
          <div className="relative overflow-hidden rounded-2xl border p-5 sm:p-7" style={{ background: `color-mix(in srgb, ${ACCENT} 5%, transparent)`, borderColor: `color-mix(in srgb, ${ACCENT} 20%, transparent)` }}>
            <div className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rounded-full blur-3xl" style={{ background: `color-mix(in srgb, ${ACCENT} 12%, transparent)` }} />
            <div className="relative flex flex-wrap items-end justify-between gap-5">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{greeting} 👋</p>
                <h2 className="mt-1 text-2xl sm:text-3xl font-heading font-bold leading-tight text-foreground">
                  Setup {isLoading ? "—" : `${ready} of ${readiness.length}`} ready
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {isLoading ? "Loading…" : firstGap ? <>Next: <b>{firstGap.label}</b> — {firstGap.hint}.</> : "Every master needed for deed registration is in place."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate("/legal/search")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-card px-3.5 py-2.5 text-xs font-heading font-semibold text-foreground shadow-sm transition-transform hover:-translate-y-0.5"
                >
                  Registration Search
                </button>
                <button
                  onClick={() => navigate("/legal/deeds")}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-heading font-semibold text-white shadow-md transition-transform hover:-translate-y-0.5"
                  style={{ background: LEGAL_GRADIENT }}
                >
                  Deed Dossiers <ArrowRight size={14} />
                </button>
              </div>
            </div>
            <div className="relative mt-5 h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${(ready / readiness.length) * 100}%`, background: LEGAL_GRADIENT }} />
            </div>
          </div>

          {/* ── Land Management pipeline ── */}
          {land && (
            <div className={`${card} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={eyebrow}>Land Management</p>
                <button onClick={() => navigate("/legal/land/properties")} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  All land properties <ChevronRight size={13} />
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                {([
                  ["Land properties", land.totalLands, Global, "/legal/land/properties"],
                  ["Active enquiries", land.activeEnquiries, MessageQuestion, "/legal/land/enquiries"],
                  ["In progress", land.inProgress, Timer1, "/legal/land/properties"],
                  ["Pending verification", land.pendingVerification, ShieldTick, "/legal/land/properties"],
                  ["On hold", land.onHold, PauseCircle, "/legal/land/properties"],
                  ["Pending registration", land.pendingRegistration, DocumentText, "/legal/land/reports"],
                  ["Mutation pending", land.mutationPending, Map1, "/legal/land/reports"],
                  ["Completed", land.completed, TickCircle, "/legal/land/properties"],
                ] as const).map(([label, value, Icon, path]) => (
                  <button key={label} onClick={() => navigate(path)} className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 text-left transition-transform hover:-translate-y-0.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: LEGAL_GRADIENT }}><Icon size={16} /></span>
                    <span className="min-w-0">
                      <span className="block text-xl font-heading font-bold tabular-nums leading-none text-foreground">{value}</span>
                      <span className="mt-1 block text-[0.6875rem] text-muted-foreground truncate">{label}</span>
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
                      <span className={`hidden sm:inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] ${l.IsOnHold ? "border-amber-500/40 bg-amber-500/10 text-amber-600" : "border-border text-muted-foreground"}`}>
                        {l.IsOnHold ? "On hold" : l.WorkflowStatus ?? "—"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

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
                            <span className="min-w-0 truncate text-foreground">{it.main}</span>
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
              ["Parties", active("buyer") + active("seller") + active("owner") + active("customer"), Profile2User, "seller"],
            ] as const).map(([label, value, Icon, key]) => (
              <button key={label} onClick={() => navigate(legalMasterPath(key))} className={`${card} p-4 flex items-center gap-3 text-left transition-transform hover:-translate-y-0.5`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: LEGAL_GRADIENT }}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-2xl font-heading font-bold tabular-nums leading-none text-foreground">{dash(value)}</span>
                  <span className="mt-1 block text-[0.6875rem] text-muted-foreground truncate">{label}</span>
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
      </LegalShell>
    </>
  );
}
