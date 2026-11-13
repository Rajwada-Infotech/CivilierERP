import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Search, Upload } from "lucide-react";
import { lookupRegistryLand, getRegistrySearches, saveRegistrySearch, updateRegistrySearch, deleteRegistrySearch, type RegistryLookup, type RegistrySearch } from "@/api/legalLandApi";
import { getLegalLookup, uploadLegalFile } from "@/api/legalMastersApi";
import { usePageRights } from "@/hooks/usePageRights";
import { GovtSiteLinks } from "./GovtSiteLinks";
import { LegalFileLink } from "./LegalDocumentPreview";
import { askLegal } from "./LegalAsk";

// Financial years (April–March) as "2026-27": the current one and the ten before it.
const finYears = () => {
  const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return Array.from({ length: 11 }, (_, i) => `${y - i}-${String(y - i + 1).slice(2)}`);
};
const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const input = "w-full border border-border bg-background px-2 py-1.5 text-sm";
const label = "block text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

/** A value with a copy button, to paste into the government site. */
const CopyField: React.FC<{ name: string; value: string | null | undefined }> = ({ name, value }) => (
  <div className="min-w-0">
    <span className={label}>{name}</span>
    <span className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
      <span className="truncate">{value || "—"}</span>
      {value && (
        <button type="button" aria-label={`Copy ${name}`} title="Copy" className="text-muted-foreground hover:text-foreground"
          onClick={() => { navigator.clipboard?.writeText(value).then(() => toast.success(`${name} copied`), () => toast.error("Could not copy")); }}>
          <Copy size={12} />
        </button>
      )}
    </span>
  </div>
);

const RESULTS = ["Clear — no other deed", "Deed found", "Encumbrance / charge found", "Record not found", "Mismatch in records", "Other"];

/** Saved registry searches of one land (used in the panel and under each land in the approved list), with Edit / Delete. */
export const RegistrySearchTable: React.FC<{ rows: RegistrySearch[]; landId: number }> = ({ rows: history, landId }) => {
  const qc = useQueryClient();
  const canEdit = usePageRights("legal-land-master").canEdit;
  const [editing, setEditing] = useState<{ id: number; result: string; deedNoFound: string; details: string; siteName: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["legal-registry-search", landId] });
  const save = async () => {
    if (!editing) return;
    try { toast.success((await updateRegistrySearch(editing.id, editing)).message); setEditing(null); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
  };
  const remove = async (h: RegistrySearch) => {
    if (!(await askLegal({ title: "Delete this search?", message: `${h.OfficeName ?? ""} · ${h.FinYear ?? ""} — ${h.Result}. This cannot be undone.`, confirmText: "Delete" }))) return;
    try { toast.success((await deleteRegistrySearch(h.SearchId)).message); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  };
  if (!history.length) return <p className="mt-1 text-xs text-muted-foreground">None yet.</p>;
  return (
    <div className="mt-1 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground"><tr><th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Office · Year</th><th className="py-1 pr-3">RS / LR</th><th className="py-1 pr-3">Result</th><th className="py-1 pr-3">Details</th><th className="py-1 pr-3">Copy</th>{canEdit && <th className="py-1" />}</tr></thead>
        <tbody>
          {history.map((h) => editing?.id === h.SearchId ? (
            <tr key={h.SearchId} className="border-t border-border/60 bg-muted/30 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap">{fmt(h.CreatedAt)}</td>
              <td className="py-1.5 pr-3">{h.OfficeName ?? "—"} · {h.FinYear ?? "—"}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">RS {h.RsDagNo ?? "—"}/{h.RsKhatianNo ?? "—"}<span className="block">LR {h.LrDagNo ?? "—"}/{h.LrKhatianNo ?? "—"}</span></td>
              <td className="py-1.5 pr-3">
                <select className={input} value={editing.result} onChange={(e) => setEditing({ ...editing, result: e.target.value })}>
                  {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input className={`${input} mt-1`} placeholder="Deed no. found" value={editing.deedNoFound} onChange={(e) => setEditing({ ...editing, deedNoFound: e.target.value })} />
              </td>
              <td className="py-1.5 pr-3" colSpan={2}>
                <textarea className={input} rows={2} placeholder="Details" value={editing.details} onChange={(e) => setEditing({ ...editing, details: e.target.value })} />
                <input className={`${input} mt-1`} placeholder="Site checked" value={editing.siteName} onChange={(e) => setEditing({ ...editing, siteName: e.target.value })} />
              </td>
              <td className="py-1.5 whitespace-nowrap">
                <button className="rounded bg-foreground px-2 py-1 text-xs font-semibold text-card" onClick={save}>Save</button>
                <button className="ml-2 text-xs underline" onClick={() => setEditing(null)}>Cancel</button>
              </td>
            </tr>
          ) : (
            <tr key={h.SearchId} className="border-t border-border/60 align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap">{fmt(h.CreatedAt)}<span className="block text-muted-foreground">{h.CreatedByName ?? ""}</span></td>
              <td className="py-1.5 pr-3">{h.OfficeName ?? "—"} · {h.FinYear ?? "—"}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">RS {h.RsDagNo ?? "—"}/{h.RsKhatianNo ?? "—"}<span className="block">LR {h.LrDagNo ?? "—"}/{h.LrKhatianNo ?? "—"}</span></td>
              <td className="py-1.5 pr-3 font-semibold">{h.Result}{h.DeedNoFound ? <span className="block font-normal">Deed {h.DeedNoFound}</span> : null}</td>
              <td className="py-1.5 pr-3">{h.Details ?? "—"}{h.SiteName ? <span className="block text-muted-foreground">{h.SiteName}</span> : null}
                {h.MatchResult ? <span className={`block font-semibold ${h.MatchResult === "Does not match" ? "text-destructive" : h.MatchResult === "Partly matches" ? "text-amber-600" : "text-emerald-600"}`}>{h.MatchResult}</span> : null}
                {h.SourceUrl ? <a className="block truncate text-muted-foreground underline" href={h.SourceUrl} target="_blank" rel="noopener noreferrer">{h.SourceUrl}</a> : null}</td>
              <td className="py-1.5 pr-3">{h.FileId ? <LegalFileLink id={h.FileId} name={h.FileName ?? "File"} /> : "—"}</td>
              {canEdit && (
                <td className="py-1.5 whitespace-nowrap text-right">
                  <button className="text-xs underline" onClick={() => setEditing({ id: h.SearchId, result: h.Result, deedNoFound: h.DeedNoFound ?? "", details: h.Details ?? "", siteName: h.SiteName ?? "" })}>Edit</button>
                  <button className="ml-2 text-xs text-destructive underline" onClick={() => remove(h)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Deed Registration → Search records: find the land (Land ID or enquiry number), choose the registration office and
 * financial year; its RS / LR references fill in by themselves. Check them on the government site, then record what
 * was found here — it is stored against the land. `landCode`: open on that land straight away (Deed Registration page);
 * the Find box is then not shown.
 */
export const RegistrySearchPanel: React.FC<{ landCode?: string }> = ({ landCode }) => {
  const qc = useQueryClient();
  const canEdit = usePageRights("legal-land-master").canEdit;
  const [q, setQ] = useState(landCode ?? "");
  const [found, setFound] = useState<RegistryLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const years = useMemo(finYears, []);
  const [districtId, setDistrictId] = useState("");
  const { data: districts = [] } = useQuery({ queryKey: ["legal-lookup", "district"], queryFn: () => getLegalLookup("district"), staleTime: 5 * 60_000 });
  const [f, setF] = useState({ officeId: "", finYear: years[0], rsDagNo: "", rsKhatianNo: "", lrDagNo: "", lrKhatianNo: "", siteName: "", sourceUrl: "", matchResult: "", result: "", deedNoFound: "", details: "", fileId: null as number | null, fileName: "" });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { data: offices = [] } = useQuery({ queryKey: ["legal-lookup", "registration-office"], queryFn: () => getLegalLookup("registration-office"), staleTime: 5 * 60_000 });
  const landId = found?.land.LandId ?? 0;
  const { data: history = [] } = useQuery({ queryKey: ["legal-registry-search", landId], queryFn: () => getRegistrySearches(landId), enabled: landId > 0 });

  const find = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await lookupRegistryLand(q.trim());
      setFound(r);
      setDistrictId(r.land.DistrictId ? String(r.land.DistrictId) : "");
      const rs = r.records.find((x) => x.Kind === "RS"), lr = r.records.find((x) => x.Kind === "LR");
      set({ rsDagNo: rs?.Dag ?? r.land.RsDagNo ?? "", rsKhatianNo: rs?.Khatian ?? r.land.RsKhatianNo ?? "", lrDagNo: lr?.Dag ?? r.land.LrDagNo ?? "", lrKhatianNo: lr?.Khatian ?? r.land.LrKhatianNo ?? "",
        result: "", deedNoFound: "", details: "", fileId: null, fileName: "" });
    } catch (err) {
      setFound(null);
      toast.error(err instanceof Error ? err.message : "Not found");
    } finally { setBusy(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (landCode) find(); }, [landCode]);

  const attach = () => {
    const el = document.createElement("input");
    el.type = "file"; el.accept = "application/pdf,image/*";
    el.onchange = async () => {
      const file = el.files?.[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) { toast.error("File is larger than 15 MB"); return; }
      try { const up = await uploadLegalFile(file); set({ fileId: up.id, fileName: up.fileName }); } catch (err) { toast.error(err instanceof Error ? err.message : "Upload failed"); }
    };
    el.click();
  };

  const save = async () => {
    if (!found) return;
    setBusy(true);
    try {
      toast.success((await saveRegistrySearch(landId, { ...f, officeId: Number(f.officeId) || null })).message);
      set({ result: "", deedNoFound: "", details: "", sourceUrl: "", matchResult: "", fileId: null, fileName: "" });
      qc.invalidateQueries({ queryKey: ["legal-registry-search", landId] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not save"); } finally { setBusy(false); }
  };

  const L = found?.land;
  const office = offices.find((o) => String(o.value) === f.officeId)?.label;
  const districtOffices = offices.filter((o) => o.active !== false && districtId && String(o.DistrictId ?? "") === districtId);
  return (
    <div className="border border-border bg-card">
      {!landCode && <p className="border-b border-border px-4 py-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Search records</p>}
      <div className="space-y-4 p-4">
        {!landCode && <form onSubmit={find} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1"><span className={label}>Land ID or enquiry number</span>
            <input className={`${input} mt-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. N24P/00001/2026-27 or ENQ-2026-00001" />
          </label>
          <button type="submit" disabled={busy || !q.trim()} className="inline-flex items-center gap-1.5 bg-foreground px-4 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card disabled:opacity-40">
            <Search size={13} /> Find
          </button>
        </form>}

        {L && (
          <>
            <div className="border border-border/70 bg-muted/30 p-3">
              <p className="text-sm font-semibold text-foreground">{L.LandCode} · {L.LandName}{L.EnquiryNo ? <span className="font-normal text-muted-foreground"> · {L.EnquiryNo}</span> : null}</p>
              <p className="text-xs text-muted-foreground">{[L.MouzaName && `${L.MouzaName}${L.JLNo ? ` (J.L. ${L.JLNo})` : ""}`, L.DistrictName, L.Area != null && `${L.Area} ${L.UnitName ?? ""}`, L.Owners && `Owners: ${L.Owners}`].filter(Boolean).join(" · ")}</p>
            </div>

            {/* District first, then the registration offices of that district to pick from. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className={label}>District *</span>
                <select className={`${input} mt-1`} value={districtId} onChange={(e) => { setDistrictId(e.target.value); set({ officeId: "" }); }}>
                  <option value="">Select…</option>
                  {districts.filter((d) => d.active !== false).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </label>
              <label><span className={label}>Financial year *</span>
                <select className={`${input} mt-1`} value={f.finYear} onChange={(e) => set({ finYear: e.target.value })}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
            {districtId && (
              <div>
                <span className={label}>Registration office *</span>
                {!districtOffices.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">No registration office set up for this district. Add one in Setup → Deed Registration Office.</p>
                ) : (
                  <div className="mt-1 overflow-x-auto border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/50 text-muted-foreground"><tr><th className="w-8 px-2 py-1.5" /><th className="px-2 py-1.5">Office</th><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Jurisdiction</th></tr></thead>
                      <tbody>
                        {districtOffices.map((o) => {
                          const on = f.officeId === String(o.value);
                          return (
                            <tr key={o.value} onClick={() => set({ officeId: String(o.value) })} className={`cursor-pointer border-t border-border ${on ? "bg-primary/10" : "hover:bg-muted/40"}`}>
                              <td className="px-2 py-1.5"><input type="radio" name="reg-office" checked={on} onChange={() => set({ officeId: String(o.value) })} aria-label={o.label} /></td>
                              <td className="px-2 py-1.5 font-semibold">{o.label}</td>
                              <td className="px-2 py-1.5">{String(o.OfficeType ?? "—")}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{String(o.Jurisdiction ?? "—")}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Filled from the land's records; copy them into the government site. */}
            <div className="grid grid-cols-2 gap-3 border border-border/70 p-3 sm:grid-cols-4">
              <CopyField name="RS Dag" value={f.rsDagNo} /><CopyField name="RS Khatian" value={f.rsKhatianNo} />
              <CopyField name="LR Dag" value={f.lrDagNo} /><CopyField name="LR Khatian" value={f.lrKhatianNo} />
              <CopyField name="Mouza" value={L.MouzaName} /><CopyField name="J.L. no." value={L.JLNo} />
              <CopyField name="Office" value={office} /><CopyField name="Year" value={f.finYear} />
            </div>
            {found.records.length > 1 && (
              <p className="text-xs text-muted-foreground">This land has {found.records.length} RS / LR records: {found.records.map((r) => `${r.Kind} ${r.Dag ?? "—"}/${r.Khatian ?? "—"}`).join(", ")}. Change the numbers below to search another one.</p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([["rsDagNo", "RS Dag"], ["rsKhatianNo", "RS Khatian"], ["lrDagNo", "LR Dag"], ["lrKhatianNo", "LR Khatian"]] as const).map(([k, n]) => (
                <label key={k}><span className={label}>{n}</span><input className={`${input} mt-1`} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>
              ))}
            </div>

            <GovtSiteLinks title="Check on the government site" hint="Opens in a new tab — paste the numbers above, then record what you found below." />

            {canEdit && (
              <div className="space-y-3 border-2 border-foreground p-3">
                <p className="text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">What was found</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label><span className={label}>Result *</span>
                    <select className={`${input} mt-1`} value={f.result} onChange={(e) => set({ result: e.target.value })}>
                      <option value="">Select…</option>
                      {found.results.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                  <label><span className={label}>Site checked</span><input className={`${input} mt-1`} value={f.siteName} onChange={(e) => set({ siteName: e.target.value })} placeholder="e.g. WB Registration" /></label>
                  <label><span className={label}>Deed no. found</span><input className={`${input} mt-1`} value={f.deedNoFound} onChange={(e) => set({ deedNoFound: e.target.value })} /></label>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
                  <label><span className={label}>Source URL (page checked)</span><input className={`${input} mt-1`} value={f.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder="https://…" /></label>
                  <label><span className={label}>Compared with our records</span>
                    <select className={`${input} mt-1`} value={f.matchResult} onChange={(e) => set({ matchResult: e.target.value })}>
                      <option value="">Select…</option>{["Matches our records", "Partly matches", "Does not match"].map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </label>
                </div>
                <p className="text-[0.6875rem] text-muted-foreground">Government site data is a check, not conclusive proof of title — title is confirmed from the documents and records.</p>
                <label className="block"><span className={label}>Details {f.result && !["Clear — no other deed", "Record not found"].includes(f.result) ? "*" : ""}</span>
                  <textarea className={`${input} mt-1`} rows={3} maxLength={2000} value={f.details} onChange={(e) => set({ details: e.target.value })} placeholder="Deed details, parties, dates, charges… as shown on the site" />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  {f.fileId ? <LegalFileLink id={f.fileId} name={f.fileName} /> : null}
                  <button type="button" onClick={attach} className="inline-flex items-center gap-1 border border-foreground px-2.5 py-1 text-xs font-semibold hover:bg-primary/10"><Upload size={12} /> {f.fileId ? "Replace screenshot / copy" : "Attach screenshot / copy"}</button>
                  <button type="button" disabled={busy || !f.result || !f.officeId} onClick={save} className="ml-auto bg-foreground px-4 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card disabled:cursor-not-allowed disabled:opacity-40">Save to {L.LandCode}</button>
                </div>
              </div>
            )}

            <div>
              <p className={label}>Saved searches for this land ({history.length})</p>
              <RegistrySearchTable rows={history} landId={landId} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
