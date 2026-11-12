import { askLegal } from "@/components/legal/LegalAsk";
import { setUserWhatsApp } from "@/api/legalLandApi";
import React, { useMemo, useRef, useState } from "react";
import { ApprovalControlPanel } from "@/components/legal/ApprovalControlPanel";
import { FileText, Upload, X } from "lucide-react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { LegalShell } from "@/components/legal/LegalShell";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef, type ColumnDef } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import {
  getLegalMeta, getLegalRows, getLegalLookup, addLegalRow, updateLegalRow, deleteLegalRow, uploadLegalFile,
  type LegalFieldMeta, type LegalOption, type LegalRow,
} from "@/api/legalMastersApi";
import type { LegalMasterEntry } from "./legalMasters";
import { LegalFileLink, LegalLinkChip, previewLegalFile, showLegalDetails } from "@/components/legal/LegalDocumentPreview";

import { isPrivilegedRole } from "@/contexts/auth.utils";
// One page for every Legal Setup master: the form, table, export and detail view are all built from the
// master's field definitions (GET /api/legal/masters/meta), so a new column only needs the backend config.
// LegalMasterTable is the same thing without the page frame, for a land property's own records
// (RS / LR records, parties) — it lists only that parent's rows and fills the parent in on save.

const YES_NO = ["Yes", "No"];

// Only Status gets the Active / Inactive switch; other yes/no rules ("Can be waived") read better as Yes / No.
const isStatus = (f: LegalFieldMeta) => f.name === "IsActive";
const displayKey = (f: LegalFieldMeta) => `${f.name}__display`;

const blank = (v: unknown) => v === undefined || v === null || v === "";
const today = () => new Date().toISOString().slice(0, 10);

/** The rows a linked field can offer for this form: active ones (plus the saved value), narrowed to the parent. */
function refOptions(f: LegalFieldMeta, lookups: Record<string, LegalOption[]>, form: Record<string, unknown>): LegalOption[] {
  const parent = f.filterBy ? form[f.filterBy] : undefined;
  return (lookups[f.ref!] ?? [])
    .filter((o) => o.active !== false || String(o.value) === String(form[f.name] ?? ""))
    .filter((o) => {
      if (!f.filterBy) return true;
      if (f.blankOk && blank(o[f.filterBy])) return true;
      return !blank(parent) && String(o[f.filterBy]) === String(parent);
    });
}

/**
 * Keeps linked fields consistent as the form changes:
 *  - a child pick that no longer belongs to its parent is cleared (change the Mouza → the Khatian resets),
 *    and that clearing cascades to its own children;
 *  - picking a record fills the empty fields it knows (RS plot → area, unit, land class).
 */
function linkFields(form: Record<string, unknown>, changed: string, fields: LegalFieldMeta[], lookups: Record<string, LegalOption[]>) {
  const next = { ...form };
  const queue = [changed];
  while (queue.length) {
    const name = queue.shift()!;
    for (const child of fields) {
      if (child.type !== "ref" || child.filterBy !== name || blank(next[child.name])) continue;
      if (!refOptions(child, lookups, next).some((o) => String(o.value) === String(next[child.name]))) {
        next[child.name] = "";
        queue.push(child.name);
      }
    }
  }
  const picked = fields.find((f) => f.name === changed);
  if (picked?.type === "ref" && picked.fill && !blank(next[changed])) {
    const row = (lookups[picked.ref!] ?? []).find((o) => String(o.value) === String(next[changed]));
    for (const [target, source] of Object.entries(picked.fill)) {
      const v = row?.[source];
      if (row && blank(next[target]) && !blank(v)) next[target] = typeof v === "number" || typeof v === "string" ? String(v) : v;
    }
  }
  return next;
}

const openFile = (id: unknown, name?: string) => previewLegalFile(id, name);

/**
 * A document field: upload (PDF / image, up to 15 MB) right away, keep the returned id in the form.
 * Replacing a file uploads a new one; the old copy stays stored on the server as evidence.
 */
const FileField: React.FC<{ value: unknown; savedName: string; onChange: (v: unknown) => void; error: boolean }> = ({ value, savedName, onChange, error }) => {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const shown = name ?? savedName;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const up = await uploadLegalFile(file);
      setName(up.fileName);
      onChange(String(up.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className={`flex min-h-[38px] items-center gap-2 rounded-lg border bg-muted px-2 py-1.5 text-sm ${error ? "border-destructive" : "border-border"}`}>
      <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {value ? (
        <>
          <button type="button" onClick={() => openFile(value, shown)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground hover:underline" title="Preview document">
            <FileText size={14} className="shrink-0 text-muted-foreground" /> <span className="truncate">{shown || "Document"}</span>
          </button>
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
            {busy ? "Uploading…" : "Replace"}
          </button>
          <button type="button" onClick={() => { setName(null); onChange(""); }} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove document">
            <X size={14} />
          </button>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex flex-1 items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <Upload size={14} /> {busy ? "Uploading…" : "Upload PDF or image (max 15 MB)"}
        </button>
      )}
    </div>
  );
};

/** A party list's label is "Name (PAN)": the name alone is what a form field holds. */
const nameOf = (label: string) => label.replace(/ \([A-Z]{5}[0-9]{4}[A-Z]\)$/, "");

/** Pick from the list or type a new entry. For a ref, the value is the picked row's id, or "new:<text>" for a
 *  new name (the server adds it to that list on save); for a text field it is the text itself. */
const Combo: React.FC<{ id: string; value: unknown; options: { value: string; label: string }[]; asRef: boolean; onChange: (v: unknown) => void; error: boolean }> = ({ id, value, options, asRef, onChange, error }) => {
  const v = String(value ?? "");
  const shown = !asRef ? v : v.startsWith("new:") ? v.slice(4) : options.find((o) => o.value === v)?.label ?? "";
  const isNew = asRef ? v.startsWith("new:") : !!v.trim() && !options.some((o) => o.label.toLowerCase() === v.trim().toLowerCase());
  return (
    <div>
      <input list={id} value={shown} placeholder="Select or type"
        className={`h-[38px] w-full rounded-lg border bg-muted px-3 text-sm ${error ? "border-destructive" : "border-border"}`}
        onChange={(e) => {
          const t = e.target.value;
          if (!asRef) return onChange(t);
          const hit = options.find((o) => o.label.toLowerCase() === t.trim().toLowerCase());
          onChange(hit ? hit.value : t.trim() ? `new:${t}` : "");
        }} />
      <datalist id={id}>{options.map((o) => <option key={o.value} value={o.label} />)}</datalist>
      {isNew && <p className="mt-1 text-[0.6875rem] text-muted-foreground">New — it will be added to the list when you save.</p>}
    </div>
  );
};

/** Dropdown with checkboxes and search: several values when adding, one when editing an existing row. */
const MultiPick: React.FC<{ options: { value: string; label: string }[]; value: unknown; editing: boolean; onChange: (v: unknown) => void; error: boolean }> = ({ options, value, editing, onChange, error }) => {
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  // Close on a click outside the dropdown.
  React.useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  if (editing) {
    return (
      <select className={`w-full border bg-background px-3 py-2 text-sm ${error ? "border-destructive" : "border-border"}`} value={String(Array.isArray(value) ? value[0] ?? "" : value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  const picked = new Set((Array.isArray(value) ? value : value ? [value] : []).map(String));
  const toggle = (v: string) => { const n = new Set(picked); if (n.has(v)) n.delete(v); else n.add(v); onChange([...n]); };
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const names = options.filter((o) => picked.has(o.value)).map((o) => o.label);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 border bg-background px-3 py-2 text-left text-sm ${error ? "border-destructive" : "border-border"}`}>
        <span className={`truncate ${names.length ? "" : "text-muted-foreground"}`}>{names.length ? names.join(", ") : "Select users…"}</span>
        <span className="text-xs text-muted-foreground">{names.length ? `${names.length} selected` : ""} ▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 border border-border bg-background shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <input autoFocus className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search users…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
            {picked.size > 0 && <button type="button" className="text-xs underline" onClick={() => onChange([])}>Clear</button>}
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {shown.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-muted/50">
                <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} /> {o.label}
              </label>
            ))}
            {!shown.length && <p className="px-2 py-1 text-xs text-muted-foreground">No match</p>}
          </div>
          <div className="flex justify-end border-t border-border px-2 py-1.5">
            <button type="button" className="bg-foreground px-3 py-1 text-xs font-semibold text-card" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
};

function toFieldDef(f: LegalFieldMeta, lookups: Record<string, LegalOption[]>, defaults: Record<string, string>): FieldDef {
  const base = { name: f.name, label: f.label, required: f.required };
  if (f.auto) {
    // Generated by the server; shown, never typed.
    return {
      ...base,
      required: false,
      type: "custom",
      render: (p) => (
        <div className="flex min-h-[38px] items-center rounded-lg border border-border bg-muted/60 px-3 text-sm text-muted-foreground">
          {p.value ? <span className="font-mono text-foreground">{String(p.value)}</span> : "Generated when saved"}
        </div>
      ),
    };
  }
  // A page's own starting value (the land's Mouza for its RS records, "Existing / Backlog" for backlog land).
  if (defaults[f.name] !== undefined) {
    return { ...toFieldDef({ ...f }, lookups, {}), defaultValue: defaults[f.name] };
  }
  // A name typed or picked from a list (owner, seller, buyer, our company).
  if (f.suggest) {
    const opts = (lookups[f.suggest] ?? []).filter((o) => o.active !== false).map((o) => ({ value: nameOf(o.label), label: nameOf(o.label) }));
    return { ...base, type: "custom", render: (p) => <Combo id={`dl-${f.name}`} value={p.value} options={opts} asRef={false} onChange={p.onChange} error={p.error} /> };
  }
  // A short list (transfer type, payment mode, a party list…): pick, or type a new one.
  if (f.type === "ref" && f.creatable) {
    return {
      ...base,
      type: "custom",
      render: (p) => (
        <Combo id={`dl-${f.name}`} value={p.value} asRef onChange={p.onChange} error={p.error}
          options={refOptions(f, lookups, p.formData).map((o) => ({ value: String(o.value), label: nameOf(o.label) }))} />
      ),
    };
  }
  // Pick several (e.g. users for an approval role) when adding — one row each; an existing row keeps one value.
  if (f.type === "ref" && f.multi) {
    return {
      ...base,
      type: "custom",
      render: (p) => <MultiPick options={refOptions(f, lookups, p.formData ?? {}).map((o) => ({ value: String(o.value), label: o.label }))}
        value={p.value} editing={false} onChange={p.onChange} error={p.error} />,
    };
  }
  switch (f.type) {
    case "textarea":
      return { ...base, type: "textarea" };
    case "int":
    case "decimal":
      return { ...base, type: "number", defaultValue: f.default !== undefined ? String(f.default) : undefined };
    case "date":
      return { ...base, type: "date", defaultValue: f.default === "today" ? today() : undefined };
    case "bit":
      return isStatus(f)
        ? { ...base, type: "toggle", defaultValue: f.default !== false }
        : { ...base, type: "select", options: YES_NO, defaultValue: f.default ? "Yes" : "No" };
    case "select":
      return { ...base, type: "select", options: f.options, defaultValue: f.default as string | undefined };
    case "ref":
      return {
        ...base,
        type: "select",
        // Inactive records stay pickable only when they are already the saved value.
        optionsProvider: (_data, _id, form) =>
          refOptions(f, lookups, form ?? {}).map((o) => ({ value: String(o.value), label: o.label })),
        disabledWhen: f.filterBy && !f.blankOk ? (form) => !form[f.filterBy!] : undefined,
        disabledPlaceholder: f.filterBy ? "Choose the parent first" : undefined,
      };
    case "file":
      return {
        ...base,
        type: "custom",
        render: (p) => <FileField value={p.value} savedName={String(p.formData[`${f.name}__label`] ?? "")} onChange={p.onChange} error={p.error} />,
      };
    default:
      return {
        ...base,
        type: "text",
        uppercase: f.upper,
        placeholder: f.type === "url" ? "https://" : f.mask === "aadhaar" ? "12-digit Aadhaar number" : undefined,
      };
  }
}

function mapRow(row: LegalRow, pk: string, fields: LegalFieldMeta[]): RecordWithId {
  const out: RecordWithId = { _id: String(row[pk]), createdBy: row.CreatedByName ?? "", updatedBy: row.UpdatedByName ?? "" };
  for (const f of fields) {
    const v = row[f.name];
    if (f.type === "bit") {
      if (isStatus(f)) out.status = Boolean(v);
      out[f.name] = isStatus(f) ? Boolean(v) : v ? "Yes" : "No";
      out[displayKey(f)] = v ? (isStatus(f) ? "Active" : "Yes") : isStatus(f) ? "Inactive" : "No";
    } else if (f.type === "ref" || f.type === "file") {
      out[f.name] = v == null ? "" : String(v);
      out[displayKey(f)] = (row[`${f.name}__label`] as string) ?? "";
      if (f.type === "file") out[`${f.name}__label`] = out[displayKey(f)];
    } else if (f.type === "date") {
      out[f.name] = v ? String(v).slice(0, 10) : "";
      out[displayKey(f)] = v ? new Date(String(v).slice(0, 10)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
    } else {
      out[f.name] = v ?? "";
      out[displayKey(f)] = v == null ? "" : String(f.type === "decimal" ? Number(v) : v);
    }
  }
  return out;
}

function toPayload(record: Record<string, unknown>, fields: LegalFieldMeta[]): LegalRow {
  const out: LegalRow = {};
  for (const f of fields) {
    if (f.auto) continue;
    const v = record[f.name];
    out[f.name] = f.type === "bit" ? (isStatus(f) ? v !== false : v === "Yes") : v === "" || v === undefined ? null : v;
  }
  return out;
}

interface TableProps {
  entry: Pick<LegalMasterEntry, "key" | "label" | "pageKey">;
  /** Only this parent's rows (a land property's id); the parent field is hidden and filled in on save. */
  parentId?: number;
  /** Form values a new row starts with (the land's Mouza for its RS records). */
  defaults?: Record<string, string>;
  /** Extra buttons on each row; `raw` is the row exactly as the API sent it. */
  rowActions?: (raw: LegalRow) => React.ReactNode;
  /** Called after any successful save, e.g. to refresh a pipeline that counts these rows. */
  onSaved?: () => void;
  /** Open this row's edit form once the rows are loaded (a link from the land property's page). */
  requestEditId?: string | null;
  /** Hide the "Add" form: rows are created elsewhere (e.g. the ownership chain) and only edited / verified here. */
  noAdd?: boolean;
  /** Keep the add form closed behind a button with this label. */
  addButton?: string;
  /** Extra classes for a row from its raw values (e.g. a tint by status). */
  rowClassName?: (raw: LegalRow) => string | undefined;
  /** Show only the rows this returns true for (a dashboard tile's filter). */
  rowFilter?: (raw: LegalRow) => boolean;
  /** Called with the new row's id after an add (e.g. to open the new land's page). */
  onCreated?: (id: number) => void;
  /** A reason this row can't be edited or deleted (its Edit / Delete show disabled with the reason), or null. */
  rowLock?: (raw: LegalRow) => string | null;
  /** Values a new row always gets; these fields are left out of the form (still shown in the table). */
  fixed?: Record<string, string>;
}

export function LegalMasterTable({ entry, parentId, defaults = {}, rowActions, onSaved, requestEditId, noAdd, addButton, rowClassName, rowFilter, onCreated, fixed, rowLock }: TableProps) {
  const rights = usePageRights(entry.pageKey);
  const { currentUser } = useAuth();
  const isAdminTier = isPrivilegedRole(currentUser?.role);
  const queryClient = useQueryClient();

  const { data: meta } = useQuery({ queryKey: ["legal-meta"], queryFn: getLegalMeta, staleTime: Infinity });
  const master = meta?.find((m) => m.key === entry.key);
  const parentField = parentId ? master?.parent : undefined;
  const allFields = useMemo(() => master?.fields ?? [], [master]);
  const fields = useMemo(() => allFields.filter((f) => f.name !== parentField), [allFields, parentField]);
  // Server-kept fields (a matched party's id) stay in the payload but never show in the form or the table.
  const shownFields = useMemo(() => fields.filter((f) => !f.hidden), [fields]);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["legal-master", entry.key, parentId ?? null],
    queryFn: () => getLegalRows(entry.key, parentId),
    staleTime: 60 * 1000,
  });

  const refs = useMemo(() => [...new Set([
    ...shownFields.filter((f) => f.type === "ref").map((f) => f.ref!),
    ...shownFields.filter((f) => f.suggest).map((f) => f.suggest!),
  ])], [shownFields]);
  const lookupResults = useQueries({
    queries: refs.map((ref) => ({ queryKey: ["legal-lookup", ref], queryFn: () => getLegalLookup(ref), staleTime: 60 * 1000 })),
  });
  const lookups = useMemo(
    () => {
      const out = Object.fromEntries(refs.map((ref, i) => [ref, lookupResults[i]?.data ?? []])) as Record<string, LegalOption[]>;
      // Within one land, "matching RS record" style picks only offer that land's rows.
      if (parentField && parentId) {
        for (const f of fields) {
          if (f.type === "ref" && f.filterBy === parentField) out[f.ref!] = (out[f.ref!] ?? []).filter((o) => String(o[parentField]) === String(parentId));
        }
      }
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refs, parentField, parentId, ...lookupResults.map((r) => r.data)],
  );
  // A pick filtered by the (hidden) parent behaves as if the parent were in the form.
  const formFields = useMemo(
    () => shownFields.filter((f) => !f.system && (!fixed || !(f.name in fixed))).map((f) => toFieldDef(f.filterBy === parentField ? { ...f, filterBy: undefined } : f, lookups, defaults)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownFields, lookups, parentField, JSON.stringify(defaults), JSON.stringify(fixed)],
  );
  const extras = useMemo(() => master?.extras ?? [], [master]);
  const data = useMemo(
    () => (rows ?? []).filter((r) => !rowFilter || rowFilter(r)).map((r) => ({ ...mapRow(r, master?.pk ?? "", fields), ...Object.fromEntries(extras.flatMap((x) => [[`${x.name}__display`, r[x.name] ?? ""], [`${x.name}__wa`, r[`${x.name}__wa`] ?? ""], [`${x.name}__uid`, r[`${x.name}__uid`] ?? ""]])) })),
    [rows, master, fields, extras, rowFilter],
  );
  const rawById = useMemo(() => new Map((rows ?? []).map((r) => [String(r[master?.pk ?? ""]), r])), [rows, master]);

  // Every field as a column (the table scrolls sideways): documents as a preview chip, long notes cut to one
  // line with the full text on hover, then Status.
  const columns: ColumnDef[] = useMemo(() => {
    const shown = shownFields.filter((f) => !isStatus(f));
    const cols: ColumnDef[] = shown.map((f, i) => ({ key: displayKey(f), label: f.label, hideOnMobile: i >= 2 }));
    // Extras go last, unless one names a field to sit right after (e.g. "Enquiry by" next to the enquiry date).
    for (const x of extras) {
      const col = { key: `${x.name}__display`, label: x.label, hideOnMobile: true };
      const at = x.after ? cols.findIndex((c) => c.key === displayKey(shown.find((f) => f.name === x.after) ?? ({ name: "" } as never))) : -1;
      if (at >= 0) cols.splice(at + 1, 0, col); else cols.push(col);
    }
    if (fields.some(isStatus)) cols.push({ key: "status", label: "Status" });
    return cols;
  }, [shownFields, fields, extras]);
  const columnRenderers = useMemo(
    () => Object.fromEntries([
      ...fields.filter((f) => f.type === "file").map((f) => [displayKey(f), (v: unknown, row: RecordWithId) => <LegalFileLink id={row[f.name]} name={String(v || "")} />]),
      ...fields.filter((f) => f.type === "url").map((f) => [displayKey(f), (v: unknown, row: RecordWithId) => <LegalLinkChip url={v} name={String(row[fields[0]?.name ? displayKey(fields[0]) : ""] ?? "")} />]),
      ...extras.filter((x) => x.whatsapp).map((x) => [`${x.name}__display`, (v: unknown, row: RecordWithId) => <WhatsAppName name={v} phone={row[`${x.name}__wa`]} userId={Number(row[`${x.name}__uid`]) || null} canSet={isAdminTier || String(row[`${x.name}__uid`]) === String(currentUser?.id ?? "")} onSaved={refresh} />]),
      ...fields.filter((f) => f.type === "textarea").map((f) => [displayKey(f), (v: unknown) => (v
        ? <span className="block max-w-[260px] truncate" title={String(v)}>{String(v)}</span>
        : <span className="text-muted-foreground">—</span>)]),
    ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, extras, isAdminTier, currentUser?.id],
  );
  const exportColumns: ExportColumn[] = fields.map((f) => ({ header: f.label, accessor: displayKey(f) }));

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["legal-master", entry.key] }),
      queryClient.invalidateQueries({ queryKey: ["legal-lookup", entry.key] }),
      queryClient.invalidateQueries({ queryKey: ["legal-summary"] }),
    ]);

  // Clicking a row opens its details in the docked side panel (not a pop-up), documents included.
  const showDetails = (row: RecordWithId) =>
    showLegalDetails(`${master?.title ?? entry.label} details`, [
      ...fields.map((f) => ({
        label: f.label,
        value: String(row[displayKey(f)] ?? ""),
        fileId: f.type === "file" ? (row[f.name] ? String(row[f.name]) : undefined) : undefined,
        wide: f.type === "textarea" || f.type === "url",
        url: f.type === "url",
      })),
      ...extras.map((x) => ({ label: x.label, value: [row[`${x.name}__display`], x.whatsapp && row[`${x.name}__wa`] ? `WhatsApp ${row[`${x.name}__wa`]}` : ""].filter(Boolean).join(" · ") || "—" })),
      { label: "Created by", value: String(row.createdBy ?? "") },
      { label: "Last updated by", value: String(row.updatedBy ?? "") },
    ]);

  const payload = (record: Record<string, unknown>) => ({
    ...toPayload(record, fields),
    ...(parentField ? { [parentField]: parentId } : {}),
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const added = await addLegalRow(entry.key, { ...payload(event.record), ...fixed });
        toast.success(added.message);
        if (onCreated && added.id) onCreated(Number(added.id));
      }
      if (event.action === "update") toast.success((await updateLegalRow(entry.key, Number(event.id), { ...payload(event.record), ...fixed })).message);
      if (event.action === "delete") toast.success((await deleteLegalRow(entry.key, Number(event.id))).message);
      onSaved?.();
    } catch (err) {
      // Refetch, then hand the refusal back so the form shows only the error (never "saved successfully").
      await refresh();
      throw err instanceof Error ? err : new Error("Operation failed");
    }
    await refresh();
  };

  if (error) return <div className="p-6 text-destructive">Could not load {entry.label}: {(error as Error).message}</div>;
  if (!master || isLoading) return <div className="p-6 text-muted-foreground">Loading {entry.label}…</div>;
  // The approval setup is changed only by an administrator; everyone else sees it read-only.
  const locked = !!master.adminOnly && !isAdminTier;
  return (
    <>
    {locked && (
      <p className="mb-3 border border-border px-3 py-2 text-xs text-muted-foreground">
        Only an administrator can change {master.title}. You can view it.
      </p>
    )}
    <MasterPage
      title={master.title}
      canCreate={rights.canCreate && !noAdd && !locked}
      collapsibleAddForm={noAdd || !!parentId || !!addButton}
      addButtonLabel={addButton}
      statusTabs
      canEdit={rights.canEdit && !locked}
      canDelete={rights.canDelete && !master.noDelete && !locked}
      fields={formFields}
      columns={columns}
      columnRenderers={columnRenderers}
      initialData={data}
      onDataEvent={handleDataEvent}
      onFieldChange={(form, name) => linkFields(form, name, fields, lookups)}
      gridCols={fields.length > 8 ? 3 : 2}
      fluid
      exportConfig={{ title: entry.label, filename: `legal-${entry.key}`, columns: exportColumns }}
      // Ask for the edit only once that row is loaded, or the form falls back to "Add".
      requestEditId={requestEditId && rawById.has(requestEditId) ? requestEditId : null}
      requestEditKey={requestEditId && rawById.has(requestEditId) ? requestEditId : null}
      rowActions={rowActions ? (row) => { const raw = rawById.get(row._id); return raw ? rowActions(raw) : null; } : undefined}
      onRowClick={showDetails}
      isRowLocked={rowLock ? (row) => { const raw = rawById.get(row._id); return raw ? rowLock(raw) : null; } : undefined}
      rowClassName={rowClassName ? (row) => { const raw = rawById.get(row._id); return raw ? rowClassName(raw) : undefined; } : undefined}
    />
    </>
  );
}

export default function LegalMasterPage({ entry }: { entry: LegalMasterEntry }) {
  const { data: meta } = useQuery({ queryKey: ["legal-meta"], queryFn: getLegalMeta, staleTime: Infinity });
  const master = meta?.find((m) => m.key === entry.key);
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", entry.area === "land" ? "Land Management" : "Setup", entry.label]} />
      <LegalShell title={entry.label} subtitle={master?.desc ?? entry.desc} icon={entry.icon}>
        {/* Approval routes & SLA (the "approval-workflow" master) are kept in the database for Registration Task
            Type, but not shown until SLA and escalation are actually used. */}
        {/* Approval Control: one row per role, its users side by side. */}
        {entry.key === "approval-authority" ? <ApprovalControlPanel /> : <LegalMasterTable entry={entry} />}
      </LegalShell>
    </>
  );
}

// A person's name with a "WhatsApp" chat link (wa.me) when their number is saved on their user. A plain 10-digit Indian
// mobile gets the 91 country code. No number yet → "+ Add WhatsApp" (that user themselves, or an administrator).
export function WhatsAppName({ name, phone, userId, canSet, onSaved }: { name: unknown; phone: unknown; userId: number | null; canSet: boolean; onSaved: () => unknown }) {
  const n = String(name ?? "").trim();
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`;
  if (!n) return <span className="text-muted-foreground">—</span>;

  const add = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userId) return;
    const no = await askLegal({ title: `WhatsApp number of ${n}`, message: "Saved on this user, so anyone can chat with them about the records they raised.", input: { label: "WhatsApp number", placeholder: "e.g. 9876543210", required: true }, confirmText: "Save" });
    if (!no) return;
    try {
      toast.success((await setUserWhatsApp(userId, no)).message);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {n}
      {digits.length >= 10 ? (
        <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
          title={`Chat with ${n} on WhatsApp (${String(phone)})`}
          className="rounded border border-emerald-600/40 px-1.5 py-0.5 text-[0.6875rem] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
          WhatsApp
        </a>
      ) : canSet && userId ? (
        <button onClick={add} title={`Add the WhatsApp number of ${n}`}
          className="rounded border border-dashed border-emerald-600/50 px-1.5 py-0.5 text-[0.6875rem] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400">
          + Add WhatsApp
        </button>
      ) : (
        <span className="text-[0.6875rem] text-muted-foreground" title="No WhatsApp number on this user yet">no WhatsApp</span>
      )}
    </span>
  );
}
