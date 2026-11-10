import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Search, Upload } from "lucide-react";
import { lookupRegistryLand, getRegistrySearches, saveRegistrySearch, type RegistryLookup, type RegistrySearch } from "@/api/legalLandApi";
import { getLegalLookup, uploadLegalFile } from "@/api/legalMastersApi";
import { usePageRights } from "@/hooks/usePageRights";
import { GovtSiteLinks } from "./GovtSiteLinks";
import { LegalFileLink } from "./LegalDocumentPreview";

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

/** Saved registry searches of one land (used in the panel and under each land in the approved list). */
export const RegistrySearchTable: React.FC<{ rows: RegistrySearch[] }> = ({ rows: history }) => (
  <>
    {!history.length ? <p className="mt-1 text-xs text-muted-foreground">None yet.</p> : (
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground"><tr><th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Office · Year</th><th className="py-1 pr-3">RS / LR</th><th className="py-1 pr-3">Result</th><th className="py-1 pr-3">Details</th><th className="py-1">Copy</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.SearchId} className="border-t border-border/60 align-top">
                <td className="py-1.5 pr-3 whitespace-nowrap">{fmt(h.CreatedAt)}<span className="block text-muted-foreground">{h.CreatedByName ?? ""}</span></td>
                <td className="py-1.5 pr-3">{h.OfficeName ?? "—"} · {h.FinYear ?? "—"}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">RS {h.RsDagNo ?? "—"}/{h.RsKhatianNo ?? "—"}<span className="block">LR {h.LrDagNo ?? "—"}/{h.LrKhatianNo ?? "—"}</span></td>
                <td className="py-1.5 pr-3 font-semibold">{h.Result}{h.DeedNoFound ? <span className="block font-normal">Deed {h.DeedNoFound}</span> : null}</td>
                <td className="py-1.5 pr-3">{h.Details ?? "—"}{h.SiteName ? <span className="block text-muted-foreground">{h.SiteName}</span> : null}</td>
                <td className="py-1.5">{h.FileId ? <LegalFileLink id={h.FileId} name={h.FileName ?? "File"} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </>
);

/** The saved searches of a land, loaded on its own (sub-row of the approved-lands table). */
export const LandRegistrySearches: React.FC<{ landId: number }> = ({ landId }) => {
  const { data = [], isLoading } = useQuery({ queryKey: ["legal-registry-search", landId], queryFn: () => getRegistrySearches(landId) });
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading searches…</p>;
  return (
    <div>
      <p className={label}>Record searches ({data.length})</p>
      <RegistrySearchTable rows={data} />
    </div>
  );
};

/**
 * Deed Registration → Search records: find the land (Land ID or enquiry number), choose the registration office and
 * financial year; its RS / LR references fill in by themselves. Check them on the government site, then record what
 * was found here — it is stored against the land.
 */
export const RegistrySearchPanel: React.FC = () => {
  const qc = useQueryClient();
  const canEdit = usePageRights("legal-land-master").canEdit;
  const [q, setQ] = useState("");
  const [found, setFound] = useState<RegistryLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const years = useMemo(finYears, []);
  const [f, setF] = useState({ officeId: "", finYear: years[0], rsDagNo: "", rsKhatianNo: "", lrDagNo: "", lrKhatianNo: "", siteName: "", result: "", deedNoFound: "", details: "", fileId: null as number | null, fileName: "" });
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
      const rs = r.records.find((x) => x.Kind === "RS"), lr = r.records.find((x) => x.Kind === "LR");
      set({ rsDagNo: rs?.Dag ?? r.land.RsDagNo ?? "", rsKhatianNo: rs?.Khatian ?? r.land.RsKhatianNo ?? "", lrDagNo: lr?.Dag ?? r.land.LrDagNo ?? "", lrKhatianNo: lr?.Khatian ?? r.land.LrKhatianNo ?? "",
        result: "", deedNoFound: "", details: "", fileId: null, fileName: "" });
    } catch (err) {
      setFound(null);
      toast.error(err instanceof Error ? err.message : "Not found");
    } finally { setBusy(false); }
  };

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
      set({ result: "", deedNoFound: "", details: "", fileId: null, fileName: "" });
      qc.invalidateQueries({ queryKey: ["legal-registry-search", landId] });
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not save"); } finally { setBusy(false); }
  };

  const L = found?.land;
  const office = offices.find((o) => String(o.value) === f.officeId)?.label;
  return (
    <div className="border border-border bg-card">
      <p className="border-b border-border px-4 py-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground">Search records</p>
      <div className="space-y-4 p-4">
        <form onSubmit={find} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1"><span className={label}>Land ID or enquiry number</span>
            <input className={`${input} mt-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. N24P/00001/2026-27 or ENQ-2026-00001" />
          </label>
          <button type="submit" disabled={busy || !q.trim()} className="inline-flex items-center gap-1.5 bg-foreground px-4 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card disabled:opacity-40">
            <Search size={13} /> Find
          </button>
        </form>

        {L && (
          <>
            <div className="border border-border/70 bg-muted/30 p-3">
              <p className="text-sm font-semibold text-foreground">{L.LandCode} · {L.LandName}{L.EnquiryNo ? <span className="font-normal text-muted-foreground"> · {L.EnquiryNo}</span> : null}</p>
              <p className="text-xs text-muted-foreground">{[L.MouzaName && `${L.MouzaName}${L.JLNo ? ` (J.L. ${L.JLNo})` : ""}`, L.DistrictName, L.Area != null && `${L.Area} ${L.UnitName ?? ""}`, L.Owners && `Owners: ${L.Owners}`].filter(Boolean).join(" · ")}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className={label}>Registration office *</span>
                <select className={`${input} mt-1`} value={f.officeId} onChange={(e) => set({ officeId: e.target.value })}>
                  <option value="">Select…</option>
                  {offices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label><span className={label}>Financial year *</span>
                <select className={`${input} mt-1`} value={f.finYear} onChange={(e) => set({ finYear: e.target.value })}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>

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
              <RegistrySearchTable rows={history} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
