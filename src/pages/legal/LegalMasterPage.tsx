import React, { useMemo, useRef, useState } from "react";
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
  if (defaults[f.name] !== undefined && f.type === "ref") {
    return { ...toFieldDef({ ...f }, lookups, {}), defaultValue: defaults[f.name] };
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
  /** Extra classes for a row from its raw values (e.g. a tint by status). */
  rowClassName?: (raw: LegalRow) => string | undefined;
}

export function LegalMasterTable({ entry, parentId, defaults = {}, rowActions, onSaved, requestEditId, noAdd, rowClassName }: TableProps) {
  const rights = usePageRights(entry.pageKey);
  const { currentUser } = useAuth();
  const isAdminTier = ["super_admin", "admin", "dba"].includes(currentUser?.role ?? "");
  const queryClient = useQueryClient();

  const { data: meta } = useQuery({ queryKey: ["legal-meta"], queryFn: getLegalMeta, staleTime: Infinity });
  const master = meta?.find((m) => m.key === entry.key);
  const parentField = parentId ? master?.parent : undefined;
  const allFields = useMemo(() => master?.fields ?? [], [master]);
  const fields = useMemo(() => allFields.filter((f) => f.name !== parentField), [allFields, parentField]);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["legal-master", entry.key, parentId ?? null],
    queryFn: () => getLegalRows(entry.key, parentId),
    staleTime: 60 * 1000,
  });

  const refs = useMemo(() => [...new Set(fields.filter((f) => f.type === "ref").map((f) => f.ref!))], [fields]);
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
    () => fields.map((f) => toFieldDef(f.filterBy === parentField ? { ...f, filterBy: undefined } : f, lookups, defaults)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, lookups, parentField, JSON.stringify(defaults)],
  );
  const extras = useMemo(() => master?.extras ?? [], [master]);
  const data = useMemo(
    () => (rows ?? []).map((r) => ({ ...mapRow(r, master?.pk ?? "", fields), ...Object.fromEntries(extras.map((x) => [`${x.name}__display`, r[x.name] ?? ""])) })),
    [rows, master, fields, extras],
  );
  const rawById = useMemo(() => new Map((rows ?? []).map((r) => [String(r[master?.pk ?? ""]), r])), [rows, master]);

  // Every field as a column (the table scrolls sideways): documents as a preview chip, long notes cut to one
  // line with the full text on hover, then Status.
  const columns: ColumnDef[] = useMemo(() => {
    const shown = fields.filter((f) => !isStatus(f));
    const cols: ColumnDef[] = shown.map((f, i) => ({ key: displayKey(f), label: f.label, hideOnMobile: i >= 2 }));
    for (const x of extras) cols.push({ key: `${x.name}__display`, label: x.label, hideOnMobile: true });
    if (fields.some(isStatus)) cols.push({ key: "status", label: "Status" });
    return cols;
  }, [fields, extras]);
  const columnRenderers = useMemo(
    () => Object.fromEntries([
      ...fields.filter((f) => f.type === "file").map((f) => [displayKey(f), (v: unknown, row: RecordWithId) => <LegalFileLink id={row[f.name]} name={String(v || "")} />]),
      ...fields.filter((f) => f.type === "url").map((f) => [displayKey(f), (v: unknown, row: RecordWithId) => <LegalLinkChip url={v} name={String(row[fields[0]?.name ? displayKey(fields[0]) : ""] ?? "")} />]),
      ...fields.filter((f) => f.type === "textarea").map((f) => [displayKey(f), (v: unknown) => (v
        ? <span className="block max-w-[260px] truncate" title={String(v)}>{String(v)}</span>
        : <span className="text-muted-foreground">—</span>)]),
    ]),
    [fields],
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
      ...extras.map((x) => ({ label: x.label, value: String(row[`${x.name}__display`] || "—") })),
      { label: "Created by", value: String(row.createdBy ?? "") },
      { label: "Last updated by", value: String(row.updatedBy ?? "") },
    ]);

  const payload = (record: Record<string, unknown>) => ({
    ...toPayload(record, fields),
    ...(parentField ? { [parentField]: parentId } : {}),
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") toast.success((await addLegalRow(entry.key, payload(event.record))).message);
      if (event.action === "update") toast.success((await updateLegalRow(entry.key, Number(event.id), payload(event.record))).message);
      if (event.action === "delete") toast.success((await deleteLegalRow(entry.key, Number(event.id))).message);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Operation failed");
    }
    // Refetch either way, so a refused save never leaves the table showing a row the server does not have.
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
      collapsibleAddForm={noAdd || !!parentId}
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
        <LegalMasterTable entry={entry} />
      </LegalShell>
    </>
  );
}
