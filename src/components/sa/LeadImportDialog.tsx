import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FieldDef } from "@/components/MasterPage";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { exportToCsv } from "@/lib/export";
import { readSheetFile } from "@/lib/sheetFile";

const API = "/api/sa/lead-import";

type ImportField = { key: string; label: string; required: boolean };
type RowResult = { rowNo: number; status: "new" | "added" | "existing" | "repeat" | "error"; reason?: string; mobile?: string; name?: string; leadUid?: string };

const STATUS_TEXT: Record<RowResult["status"], string> = {
  new: "New", added: "Added", existing: "Already a lead", repeat: "Repeated in file", error: "Problem",
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithAuth(`${API}${path}`, { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** The lead form's own source fields (How they came, Platform, Campaign, Ad, Channel Partner) — same options as adding one lead. */
  sourceFields: FieldDef[];
}

const SelectOptions: React.FC<{ field: FieldDef }> = ({ field }) => {
  const { data = [] } = useQuery({
    queryKey: ["lead-import-options", field.name],
    queryFn: () => field.asyncOptions!(),
    enabled: !!field.asyncOptions,
    staleTime: 5 * 60_000,
  });
  const opts = field.asyncOptions ? data : (field.options ?? []).map((o) => ({ value: o, label: o }));
  return <>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</>;
};

/** Sales Automation → Leads → Import: a lead export (Meta, Google, a portal, any sheet) in, checked, then added. */
export const LeadImportDialog: React.FC<Props> = ({ open, onClose, sourceFields }) => {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headings, setHeadings] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [remembered, setRemembered] = useState(false);
  const [source, setSource] = useState<Record<string, string>>({});
  const [sendWelcome, setSendWelcome] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [imported, setImported] = useState(false);
  const [busy, setBusy] = useState<"" | "reading" | "checking" | "importing">("");
  const [progress, setProgress] = useState(0);

  const { data: meta } = useQuery({
    queryKey: ["lead-import-fields"],
    queryFn: async (): Promise<{ fields: ImportField[]; batch: number }> => {
      const r = await fetchWithAuth(`${API}/fields`);
      if (!r.ok) throw new Error("Could not load the import fields");
      return r.json();
    },
    enabled: open,
  });

  const reset = () => {
    setFileName(""); setHeadings([]); setRows([]); setMapping({}); setRemembered(false);
    setSource({}); setSendWelcome(false); setResults(null); setImported(false); setProgress(0);
  };
  useEffect(() => { if (!open) reset(); }, [open]);

  const pickFile = async (f: File | null) => {
    if (!f) return;
    reset();
    setBusy("reading");
    try {
      const grid = (await readSheetFile(f)).filter((r) => r.some((c) => String(c ?? "").trim()));
      if (grid.length < 2) throw new Error("The file needs a heading row and at least one lead");
      const heads = grid[0].map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
      const m = await post<{ mapping: Record<string, string>; source: Record<string, string> | null; remembered: boolean }>("/mapping", { headings: heads });
      setFileName(f.name);
      setHeadings(heads);
      setRows(grid.slice(1));
      setMapping(m.mapping);
      setRemembered(m.remembered);
      setSource(Object.fromEntries(Object.entries(m.source ?? {}).map(([k, v]) => [k, String(v)])));
    } catch (e: any) {
      toast.error(e.message || "Could not read the file");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const run = async (dryRun: boolean) => {
    const size = meta?.batch ?? 500;
    setBusy(dryRun ? "checking" : "importing");
    setProgress(0);
    const out: RowResult[] = [];
    try {
      for (let i = 0; i < rows.length; i += size) {
        const r = await post<{ results: RowResult[] }>("/run", {
          headings, mapping, rows: rows.slice(i, i + size), firstRowNo: i + 2, // row 1 is the headings
          source, sendWelcome, dryRun,
        });
        out.push(...r.results);
        setProgress(Math.min(rows.length, i + size));
      }
      // A mobile repeated across parts of a big file: only the first counts as new.
      if (dryRun) {
        const first = new Map<string, number>();
        for (const r of out) {
          if (r.status !== "new" || !r.mobile) continue;
          if (first.has(r.mobile)) Object.assign(r, { status: "repeat", reason: `Same mobile as row ${first.get(r.mobile)} in this file` });
          else first.set(r.mobile, r.rowNo);
        }
      }
      setResults(out);
      if (!dryRun) {
        setImported(true);
        const added = out.filter((r) => r.status === "added").length;
        toast.success(`${added} lead${added === 1 ? "" : "s"} added`);
        qc.invalidateQueries({ queryKey: ["sa-leads"] });
      }
    } catch (e: any) {
      toast.error(e.message || "Import stopped");
    } finally {
      setBusy("");
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (results ?? []).forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [results]);
  const problems = (results ?? []).filter((r) => r.status !== "new" && r.status !== "added");
  const mobileMapped = Object.values(mapping).includes("Mobile");
  const setMap = (heading: string, field: string) => {
    setResults(null);
    setMapping((m) => {
      const next = { ...m };
      // A field is filled from one column only.
      if (field) Object.keys(next).forEach((h) => { if (next[h] === field) delete next[h]; });
      if (field) next[heading] = field; else delete next[heading];
      return next;
    });
  };

  const downloadProblems = () => exportToCsv(
    problems as unknown as Record<string, unknown>[],
    [{ header: "Row", accessor: "rowNo" }, { header: "Mobile", accessor: "mobile" }, { header: "Result", accessor: (r) => STATUS_TEXT[r.status as RowResult["status"]] }, { header: "Why", accessor: "reason" }],
    `${fileName.replace(/\.[^.]+$/, "")}-not-imported`,
  );

  const cls = "w-full text-sm border border-border rounded px-2 py-1.5 bg-background";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import leads from a file</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          <p className="text-xs text-muted-foreground">
            Export the leads from Meta Leads Center, Google Ads, LinkedIn, a property portal or any sheet (.csv, .tsv or .xlsx) and drop it here.
            Every row is checked like a lead typed in by hand; a mobile already in Sales Automation is left out.
          </p>

          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:bg-muted/40"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] ?? null); }}>
            {busy === "reading" ? <Loader2 className="animate-spin" size={22} /> : <Upload size={22} className="text-muted-foreground" />}
            <span className="text-sm text-foreground">{fileName ? <><FileSpreadsheet size={14} className="inline mr-1" />{fileName} · {rows.length} rows</> : "Choose a file or drop it here"}</span>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx" className="sr-only" disabled={!!busy} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </label>

          {headings.length > 0 && meta && (
            <>
              <section className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Columns</h3>
                  <span className="text-xs text-muted-foreground">{remembered ? "Matched the way you did last time for this kind of file" : "Matched by name — check and change any"}</span>
                </div>
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-muted/30 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Column in the file</th><th className="px-3 py-2 font-medium">First value</th><th className="px-3 py-2 font-medium">Goes into</th>
                    </tr></thead>
                    <tbody>
                      {headings.map((h, i) => (
                        <tr key={`${h}-${i}`} className="border-t border-border">
                          <td className="px-3 py-1.5 whitespace-nowrap">{h}</td>
                          <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[14rem]">{rows[0]?.[i] || "—"}</td>
                          <td className="px-3 py-1.5">
                            <select className={cls} value={mapping[h] ?? ""} onChange={(e) => setMap(h, e.target.value)} aria-label={`Lead field for ${h}`}>
                              <option value="">Leave out</option>
                              {meta.fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!mobileMapped && <p className="text-xs text-destructive">Choose which column holds the mobile number.</p>}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Where these leads came from</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sourceFields.map((f) => (
                    <div key={f.name}>
                      <label className="text-xs text-muted-foreground block mb-1" htmlFor={`imp-${f.name}`}>{f.label}</label>
                      <select id={`imp-${f.name}`} className={cls} value={source[f.name] ?? ""}
                        onChange={(e) => { setResults(null); setSource((s) => ({ ...s, [f.name]: e.target.value })); }}>
                        <option value="">—</option>
                        <SelectOptions field={f} />
                      </select>
                    </div>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-foreground pt-1">
                  <input type="checkbox" checked={sendWelcome} onChange={(e) => setSendWelcome(e.target.checked)} />
                  Send each new lead the welcome message (leave off for old lists)
                </label>
              </section>

              {results && (
                <section className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(["added", "new", "existing", "repeat", "error"] as const).filter((s) => counts[s]).map((s) => (
                      <span key={s} className={`text-xs px-2.5 py-1 rounded-full border ${s === "added" || s === "new" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : s === "error" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}>
                        {STATUS_TEXT[s]}: {counts[s]}
                      </span>
                    ))}
                  </div>
                  {problems.length > 0 && (
                    <div className="rounded-lg border border-border max-h-56 overflow-y-auto">
                      <table className="w-full text-xs">
                        <tbody>
                          {problems.slice(0, 200).map((r) => (
                            <tr key={r.rowNo} className="border-b border-border last:border-0">
                              <td className="px-3 py-1.5 text-muted-foreground tabular-nums whitespace-nowrap">Row {r.rowNo}</td>
                              <td className="px-3 py-1.5 whitespace-nowrap">{STATUS_TEXT[r.status]}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{r.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        {headings.length > 0 && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-border flex-wrap">
            <span className="text-xs text-muted-foreground tabular-nums">
              {busy === "checking" || busy === "importing" ? `${busy === "checking" ? "Checking" : "Importing"} ${progress} of ${rows.length}…` : ""}
            </span>
            <div className="flex gap-2 flex-wrap">
              {problems.length > 0 && (
                <button type="button" onClick={downloadProblems} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border border-border hover:bg-muted">
                  <Download size={14} /> Rows not imported
                </button>
              )}
              {imported ? (
                <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 px-4 py-2 btn-module text-white text-sm font-medium rounded-lg">
                  <CheckCircle2 size={14} /> Done
                </button>
              ) : !results ? (
                <button type="button" disabled={!!busy || !mobileMapped} onClick={() => run(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 btn-module text-white text-sm font-medium rounded-lg disabled:opacity-40">
                  {busy === "checking" && <Loader2 size={14} className="animate-spin" />} Check {rows.length} rows
                </button>
              ) : (
                <button type="button" disabled={!!busy || !counts.new} onClick={() => run(false)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 btn-module text-white text-sm font-medium rounded-lg disabled:opacity-40">
                  {busy === "importing" && <Loader2 size={14} className="animate-spin" />} Import {counts.new ?? 0} new lead{counts.new === 1 ? "" : "s"}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
