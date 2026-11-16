import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readSheetFile } from "@/lib/sheetFile";
import { buildWorkbook, downloadBlob, readSheetTable, type XlsxCell } from "@/lib/xlsxBook";
import { importCandidates, type CandidateImportResult, type CandidateImportRow } from "@/api/candidateMasterApi";

// One entry per Candidates Master field (Candidate ID is generated on save, Resume is a file and is added on the
// candidate's own form). `aliases` are the heading spellings accepted when reading the file (letters/digits only).
type FieldSpec = { key: string; label: string; required?: boolean; aliases: string[]; width: number; text?: boolean; hint: string };
const FIELDS: FieldSpec[] = [
  { key: "name", label: "Name", required: true, aliases: ["name", "candidatename", "fullname"], width: 26, hint: "Required, up to 150 characters" },
  { key: "contact", label: "Contact", aliases: ["contact", "phone", "mobile", "contactno", "phoneno", "mobileno"], width: 16, text: true, hint: "Phone number, e.g. 9876543210" },
  { key: "email", label: "Email", aliases: ["email", "emailid", "emailaddress"], width: 28, hint: "Must be unique, e.g. name@company.com" },
  { key: "qualification", label: "Qualification", aliases: ["qualification", "education"], width: 22, hint: "Up to 200 characters" },
  { key: "experience", label: "Experience", aliases: ["experience", "exp"], width: 18, hint: "Text, e.g. 3 years 6 months" },
  { key: "expectedSalary", label: "Expected Salary", aliases: ["expectedsalary", "expectedctc", "expsalary"], width: 16, hint: "Number only" },
  { key: "currentSalary", label: "Current Salary", aliases: ["currentsalary", "currentctc"], width: 16, hint: "Number only" },
  { key: "noticePeriod", label: "Notice Period", aliases: ["noticeperiod", "notice"], width: 18, hint: "Text, e.g. 30 days / Immediate" },
  { key: "interviewStatus", label: "Interview Result", aliases: ["interviewresult", "interviewstatus", "result"], width: 18, hint: "Selected, Rejected or On Hold (or leave blank)" },
  { key: "remarks", label: "Remarks", aliases: ["remarks", "remark", "notes"], width: 32, hint: "Up to 1000 characters" },
  { key: "status", label: "Status", aliases: ["status", "active", "isactive"], width: 12, hint: "Active or Inactive (blank = Active)" },
];

const ALIASES = Object.fromEntries(FIELDS.map((f) => [f.key, f.aliases]));

async function downloadTemplate() {
  const header: XlsxCell[] = FIELDS.map((f) => ({ v: f.required ? `${f.label} *` : f.label, s: f.required ? "required" : "header" }));
  const guide: XlsxCell[][] = [
    [{ v: "Column", s: "header" }, { v: "Required", s: "header" }, { v: "What to enter", s: "header" }],
    ...FIELDS.map((f): XlsxCell[] => [f.label, f.required ? "Yes" : "No", f.hint]),
  ];
  const help: XlsxCell[][] = [
    [{ v: "How to import candidates", s: "title" }],
    ["1. Fill the 'Candidates' sheet — one candidate per row, starting from row 2. Do not change or remove the heading row."],
    ["2. Name is the only required column. Candidate ID is created automatically when the candidates are saved."],
    ["3. The resume is a file and cannot come from Excel — attach it later from the candidate's own form."],
    ["4. Save the file, then use Import Excel on the Candidates page. Every row is checked first; nothing is saved until all rows are correct."],
  ];
  const lists = [
    { sqref: "I2:I2000", formula: "Lists!$A$2:$A$4" },
    { sqref: "K2:K2000", formula: "Lists!$B$2:$B$3" },
  ];
  const blank: XlsxCell[][] = [];
  const blob = await buildWorkbook([
    {
      name: "Candidates",
      rows: [header, ...blank],
      widths: FIELDS.map((f) => f.width),
      columnStyles: FIELDS.map((f) => (f.text ? ("text" as const) : undefined)),
      freezeBelowRow: 2,
      lists,
    },
    { name: "Field Guide", rows: guide, widths: [22, 12, 60], freezeBelowRow: 2 },
    { name: "Lists", rows: [[{ v: "Interview Result", s: "header" }, { v: "Status", s: "header" }], ["Selected", "Active"], ["Rejected", "Inactive"], ["On Hold", ""]], widths: [20, 14] },
    { name: "Instructions", rows: help, widths: [110] },
  ]);
  downloadBlob(blob, "Candidates_Import_Template.xlsx");
}

interface Props { open: boolean; onClose: () => void }

export const CandidateImportDialog: React.FC<Props> = ({ open, onClose }) => {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CandidateImportRow[]>([]);
  const [check, setCheck] = useState<CandidateImportResult | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "importing">("");

  const reset = () => { setFileName(""); setRows([]); setCheck(null); setDone(null); };
  useEffect(() => { if (!open) reset(); }, [open]);

  const pickFile = async (f: File | null) => {
    if (!f) return;
    reset();
    setBusy("reading");
    try {
      const grid = await readSheetFile(f);
      const { table, missing } = readSheetTable(grid, ALIASES);
      if (missing.includes("name")) throw new Error("The Name column is missing — use the downloaded template");
      if (!table.length) throw new Error("The file has no candidate rows");
      if (table.length > 2000) throw new Error("Import at most 2000 candidates at a time");
      setFileName(f.name);
      setRows(table);
      setCheck(await importCandidates(table, true));
    } catch (e: any) {
      toast.error(e.message || "Could not read the file");
      reset();
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runImport = async () => {
    setBusy("importing");
    try {
      const r = await importCandidates(rows, false);
      if (r.imported > 0) {
        setDone(r.imported);
        toast.success(`${r.imported} candidate${r.imported === 1 ? "" : "s"} imported`);
        qc.invalidateQueries({ queryKey: ["candidate-master"] });
      } else {
        setCheck(r);
      }
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setBusy("");
    }
  };

  const problems = (check?.results ?? []).filter((r) => r.errors.length);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col">
        <DialogHeader><DialogTitle>Import candidates from Excel</DialogTitle></DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground max-w-md">
              Download the template, fill one candidate per row, then upload it. Every row is checked first;
              nothing is saved until all rows are correct.
            </p>
            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-border hover:bg-muted rounded-lg">
              <Download size={14} /> Download template
            </button>
          </div>

          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-6 cursor-pointer hover:bg-muted/40"
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] ?? null); }}>
            {busy === "reading" ? <Loader2 className="animate-spin" size={22} /> : <Upload size={22} className="text-muted-foreground" />}
            <span className="text-sm text-foreground">
              {fileName ? <><FileSpreadsheet size={14} className="inline mr-1" />{fileName} · {rows.length} rows</> : "Choose the filled template (.xlsx) or drop it here"}
            </span>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv" className="sr-only" disabled={!!busy || done !== null} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </label>

          {done !== null && (
            <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={16} /> {done} candidate{done === 1 ? "" : "s"} saved and added to the Candidates list.</p>
          )}

          {check && done === null && (
            <section className="space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full border border-border text-muted-foreground">Rows: {check.summary.total}</span>
                <span className="px-2.5 py-1 rounded-full border border-emerald-500/40 text-emerald-700 dark:text-emerald-300">Valid: {check.summary.valid}</span>
                {check.summary.invalid > 0 && <span className="px-2.5 py-1 rounded-full border border-destructive/40 text-destructive">With errors: {check.summary.invalid}</span>}
              </div>
              {problems.length > 0 ? (
                <>
                  <p className="text-xs text-destructive">Correct these rows in the file and upload it again — nothing has been saved.</p>
                  <div className="rounded-lg border border-border max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-muted/30 text-left text-muted-foreground"><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Problem</th></tr></thead>
                      <tbody>
                        {problems.slice(0, 300).map((r) => (
                          <tr key={r.rowNo} className="border-t border-border align-top">
                            <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{r.rowNo}</td>
                            <td className="px-3 py-1.5">{r.name || "—"}</td>
                            <td className="px-3 py-1.5 text-destructive">{r.errors.join("; ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">All rows are correct and ready to import.</p>
              )}
            </section>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          {done !== null ? (
            <button type="button" onClick={onClose} className="px-4 py-2 btn-module text-white text-sm font-medium rounded-lg">Done</button>
          ) : (
            <>
              <button type="button" disabled={!!busy} onClick={onClose} className="px-3 py-2 text-sm border border-border hover:bg-muted rounded-lg">Cancel</button>
              <button type="button" disabled={!!busy || !check || problems.length > 0} onClick={runImport}
                className="inline-flex items-center gap-1.5 px-4 py-2 btn-module text-white text-sm font-medium rounded-lg disabled:opacity-40">
                {busy === "importing" && <Loader2 size={14} className="animate-spin" />}
                Import {check?.summary.valid ?? 0} candidate{check?.summary.valid === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
