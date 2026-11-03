import React, { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Circle, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalLookup, getLegalRows, uploadLegalFile, type LegalRow } from "@/api/legalMastersApi";
import { recordOwnershipChange, undoOwnershipChange, updateOwnershipChange, type OwnershipChange } from "@/api/legalLandApi";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { askLegal } from "@/components/legal/LegalAsk";
import { LEGAL_GRADIENT } from "@/components/legal/LegalShell";
import { StepTabs, stepCard } from "./StepTabs";

// Pipeline step 5 — Ownership History & Verification, read the way a chain of title is read:
//   1. the first documented owner(s);
//   2. each change of ownership, one at a time: this land's current owners give (all or part of) their share
//      to new owners on a date, by sale / inheritance / gift / partition / court order, with its document.
// The server ends the givers' ownership the day before, starts the new owners on that date, keeps any share
// not given, and writes the transfer / inheritance / partition records itself. A reviewer then verifies.

type StepProps = { landId: number; onSaved: () => void };
const eyebrow = "mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground";
const input = "w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm";
const label = "text-xs text-muted-foreground";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50";
const fmt = (d: unknown) => (d ? new Date(String(d).slice(0, 10)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const pct = (v: unknown) => `${Number(v ?? 0).toFixed(2).replace(/\.00$/, "")}%`;
const dayBefore = (d: string) => (d ? new Date(new Date(d).getTime() - 86400000).toISOString().slice(0, 10) : "");

const VERIFY_STYLE: Record<string, string> = {
  Verified: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  Pending: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  Rejected: "border-rose-500/40 bg-rose-500/10 text-rose-600",
  "Needs Correction": "border-rose-500/40 bg-rose-500/10 text-rose-600",
};
const Chip: React.FC<{ s: unknown }> = ({ s }) => (
  <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] ${VERIFY_STYLE[String(s)] ?? "border-border text-muted-foreground"}`}>{String(s ?? "—")}</span>
);

/** Upload one file at once; shows its name, lets you replace or remove it. */
const FilePick: React.FC<{ value: { id: number; name: string } | null; onChange: (v: { id: number; name: string } | null) => void; placeholder: string }> = ({ value, onChange, placeholder }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className={`${input} flex items-center gap-2`}>
      <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setBusy(true);
        try { const r = await uploadLegalFile(f); onChange({ id: r.id, name: r.fileName }); } catch (err) { toast.error(err instanceof Error ? err.message : "Upload failed"); } finally { setBusy(false); }
      }} />
      {value ? (
        <>
          <span className="min-w-0 flex-1 truncate">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-destructive" aria-label="Remove file"><X size={13} /></button>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="flex flex-1 items-center gap-1.5 text-left text-muted-foreground hover:text-foreground">
          <Upload size={13} /> {busy ? "Uploading…" : placeholder}
        </button>
      )}
    </div>
  );
};

/** The one form: first owner, or one change of ownership. */
const ChangeForm: React.FC<StepProps & { current: LegalRow[]; onDone: () => void }> = ({ landId, current, onSaved, onDone }) => {
  const first = current.length === 0;
  const types = useQuery({ queryKey: ["legal-lookup", "transfer-type"], queryFn: () => getLegalLookup("transfer-type") });
  const rels = useQuery({ queryKey: ["legal-lookup", "relationship-type"], queryFn: () => getLegalLookup("relationship-type") });
  const docTypes = useQuery({ queryKey: ["legal-lookup", "document-type"], queryFn: () => getLegalLookup("document-type") });
  const [typeId, setTypeId] = useState("");
  const typeName = (types.data ?? []).find((t) => String(t.value) === typeId)?.label ?? "";
  const isInheritance = /inherit/i.test(typeName);
  const isPartition = /partition/i.test(typeName);
  // Relationship to the giving owner matters only between family / co-owners; a buyer or a court-ordered owner
  // is usually not related, so the field is hidden for those (and is always optional).
  const askRelation = first || !typeId || /inherit|gift|partition|settlement/i.test(typeName);
  const [date, setDate] = useState("");
  // Givers default to "everything they hold".
  const [give, setGive] = useState<Record<string, { on: boolean; share: string }>>(() =>
    Object.fromEntries(current.map((r) => [String(r.RecordId), { on: current.length === 1, share: String(Number(r.SharePct)) }])));
  const [to, setTo] = useState([{ name: "", guardian: "", rel: "", share: first ? "100" : "" }]);
  const [doc, setDoc] = useState({ docTypeId: "", documentNo: "", deedNo: "", value: "" });
  const [file, setFile] = useState<{ id: number; name: string } | null>(null);
  const [inh, setInh] = useState({ dateOfDeath: "", supportingType: "None" });
  const [deathCert, setDeathCert] = useState<{ id: number; name: string } | null>(null);
  const [heirCert, setHeirCert] = useState<{ id: number; name: string } | null>(null);
  const [newRefs, setNewRefs] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  const givers = current.filter((r) => give[String(r.RecordId)]?.on);
  const given = givers.reduce((a, r) => a + (Number(give[String(r.RecordId)]?.share) || 0), 0);
  const received = to.reduce((a, x) => a + (Number(x.share) || 0), 0);
  const balanced = first ? received > 0 && received <= 100.0001 : Math.abs(given - received) < 0.0001 && given > 0;
  const latestStart = givers.map((r) => String(r.ValidFrom).slice(0, 10)).sort().pop();

  const save = async () => {
    const body: OwnershipChange = {
      first, date, transferTypeId: first ? undefined : Number(typeId) || undefined,
      from: first ? undefined : givers.map((r) => ({ recordId: Number(r.RecordId), sharePct: Number(give[String(r.RecordId)].share) })),
      to: to.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), guardian: x.guardian.trim() || undefined, relationshipTypeId: askRelation ? Number(x.rel) || undefined : undefined, sharePct: Number(x.share) })),
      docTypeId: Number(doc.docTypeId) || undefined, documentNo: doc.documentNo || undefined, deedNo: doc.deedNo || undefined,
      transferValue: doc.value ? Number(doc.value) : undefined, fileId: file?.id,
      inheritance: isInheritance ? { dateOfDeath: inh.dateOfDeath || undefined, supportingType: inh.supportingType, deathCertFileId: deathCert?.id, heirCertFileId: heirCert?.id } : undefined,
      partitionNewReferences: isPartition ? newRefs || undefined : undefined,
      remarks: remarks || undefined,
    };
    setBusy(true);
    try {
      toast.success((await recordOwnershipChange(landId, body)).message);
      onDone();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${stepCard} p-4 sm:p-5`}>
      <p className={eyebrow}>{first ? "Add the first documented owner" : "Record a change of ownership"}</p>

      {/* 1 — how and when */}
      <div className="grid gap-3 sm:grid-cols-2">
        {!first && (
          <label className={label}>How did the ownership change? *
            <select className={`${input} mt-1`} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Select…</option>
              {(types.data ?? []).filter((t) => t.active !== false).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
        )}
        <label className={label}>{first ? "Owner since *" : "Date of change *"}
          <input type="date" className={`${input} mt-1`} value={date} min={latestStart || undefined} onChange={(e) => setDate(e.target.value)} />
          {!first && date && givers.length > 0 && <span className="mt-1 block text-[0.6875rem]">Previous ownership will end on {fmt(dayBefore(date))}.</span>}
        </label>
      </div>

      {/* 2 — from: this land's current owners */}
      {!first && (
        <div className="mt-4">
          <p className="text-xs font-medium text-foreground">From — current owners of this land (tick who gives, and how much)</p>
          <div className="mt-2 space-y-2">
            {current.map((r) => {
              const k = String(r.RecordId);
              const g = give[k];
              return (
                <div key={k} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <label className="flex min-w-[200px] flex-1 items-center gap-2">
                    <input type="checkbox" checked={!!g?.on} onChange={(e) => setGive({ ...give, [k]: { ...g, on: e.target.checked } })} />
                    <span>{String(r.OwnerName)}{r.OwnerGuardian ? <span className="text-xs text-muted-foreground"> c/o {String(r.OwnerGuardian)}</span> : null}
                      <span className="block text-xs text-muted-foreground">holds {pct(r.SharePct)} since {fmt(r.ValidFrom)}</span></span>
                  </label>
                  {g?.on && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">gives
                      <input className={`${input} w-24`} type="number" min={0} max={Number(r.SharePct)} value={g.share} onChange={(e) => setGive({ ...give, [k]: { ...g, share: e.target.value } })} />%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3 — to: new owners */}
      <div className="mt-4">
        <p className="text-xs font-medium text-foreground">{first ? "First owner(s)" : isInheritance ? "To — legal heirs" : "To — new owner(s)"}</p>
        <div className="mt-2 space-y-2">
          {to.map((x, i) => (
            <div key={i} className={`grid gap-2 ${askRelation ? "sm:grid-cols-[1.3fr_1.2fr_1fr_90px_auto]" : "sm:grid-cols-[1.5fr_1.4fr_90px_auto]"}`}>
              <input className={input} placeholder="Name *" value={x.name} onChange={(e) => setTo(to.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <input className={input} placeholder="Father / husband" value={x.guardian} onChange={(e) => setTo(to.map((y, j) => (j === i ? { ...y, guardian: e.target.value } : y)))} />
              {askRelation && <select className={input} value={x.rel} title="Relationship to the giving owner (optional)" onChange={(e) => setTo(to.map((y, j) => (j === i ? { ...y, rel: e.target.value } : y)))}>
                <option value="">Not related</option>
                {(rels.data ?? []).filter((t) => t.active !== false).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>}
              <input className={input} type="number" min={0} max={100} placeholder="Share %" value={x.share} onChange={(e) => setTo(to.map((y, j) => (j === i ? { ...y, share: e.target.value } : y)))} />
              <button type="button" className="justify-self-start text-muted-foreground hover:text-destructive disabled:opacity-30" disabled={to.length === 1} onClick={() => setTo(to.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className={btn} onClick={() => setTo([...to, { name: "", guardian: "", rel: "", share: "" }])}><Plus size={12} /> Add {isInheritance ? "heir" : "owner"}</button>
        </div>
        <p className={`mt-1 text-xs ${balanced ? "text-muted-foreground" : "text-amber-600"}`}>
          {first ? `Total ${received}%` : `Given ${given}% · received ${received}%${balanced ? "" : " — must be equal"}`}
        </p>
      </div>

      {/* 4 — inheritance evidence */}
      {isInheritance && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={label}>Date of death<input type="date" className={`${input} mt-1`} value={inh.dateOfDeath} onChange={(e) => setInh({ ...inh, dateOfDeath: e.target.value })} /></label>
          <label className={label}>Will / probate / court order
            <select className={`${input} mt-1`} value={inh.supportingType} onChange={(e) => setInh({ ...inh, supportingType: e.target.value })}>
              {["None", "Will", "Probate", "Succession Certificate", "Court Order"].map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <div className={label}>Death certificate<div className="mt-1"><FilePick value={deathCert} onChange={setDeathCert} placeholder="Upload" /></div></div>
          <div className={label}>Legal heir certificate<div className="mt-1"><FilePick value={heirCert} onChange={setHeirCert} placeholder="Upload" /></div></div>
        </div>
      )}
      {isPartition && (
        <label className={`${label} mt-4 block`}>New Dag / Khatian references<input className={`${input} mt-1`} value={newRefs} onChange={(e) => setNewRefs(e.target.value)} /></label>
      )}

      {/* 5 — the document */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className={label}>Document type
          <select className={`${input} mt-1`} value={doc.docTypeId} onChange={(e) => setDoc({ ...doc, docTypeId: e.target.value })}>
            <option value="">Select…</option>
            {(docTypes.data ?? []).filter((t) => t.active !== false).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className={label}>Document number<input className={`${input} mt-1`} value={doc.documentNo} onChange={(e) => setDoc({ ...doc, documentNo: e.target.value })} /></label>
        <label className={label}>Deed number (if any)<input className={`${input} mt-1`} value={doc.deedNo} onChange={(e) => setDoc({ ...doc, deedNo: e.target.value })} /></label>
        <div className={label}>Document file<div className="mt-1"><FilePick value={file} onChange={setFile} placeholder="Upload PDF / image" /></div></div>
        {!first && !isInheritance && (
          <label className={label}>Value (₹, if any)<input type="number" className={`${input} mt-1`} value={doc.value} onChange={(e) => setDoc({ ...doc, value: e.target.value })} /></label>
        )}
        <label className={`${label} sm:col-span-2 xl:col-span-3`}>Remarks<input className={`${input} mt-1`} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-50" style={{ background: LEGAL_GRADIENT }}
          disabled={busy || !date || !balanced || (!first && (!typeId || !givers.length)) || to.some((x) => !x.name.trim())}
          onClick={save}>
          {first ? "Save first owner" : "Save change"}
        </button>
        <button className={btn} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
};

/** Edits one change: date, document and the new owners' names (shares stay; delete and re-record for those). */
const EditChange: React.FC<{ landId: number; date: string; evs: LegalRow[]; records: LegalRow[]; onClose: () => void; onSaved: () => void }> = ({ landId, date, evs, records, onClose, onSaved }) => {
  const rels = useQuery({ queryKey: ["legal-lookup", "relationship-type"], queryFn: () => getLegalLookup("relationship-type") });
  const docTypes = useQuery({ queryKey: ["legal-lookup", "document-type"], queryFn: () => getLegalLookup("document-type") });
  const e0 = evs[0];
  const [d, setD] = useState(date);
  const [doc, setDoc] = useState({ docTypeId: e0.DocTypeId ? String(e0.DocTypeId) : "", documentNo: String(e0.DocumentNo ?? ""), deedNo: String(e0.DeedNo ?? ""), value: e0.TransferValue != null ? String(e0.TransferValue) : "", remarks: String(e0.Remarks ?? "") });
  const [file, setFile] = useState<{ id: number; name: string } | null>(e0.DocFileId ? { id: Number(e0.DocFileId), name: String(e0.DocFileId__label ?? "Document") } : null);
  const [owners, setOwners] = useState(evs.map((e) => ({
    eventId: Number(e.EventId), name: String(e.NewOwnerName ?? ""), guardian: String(e.NewOwnerGuardian ?? ""),
    rel: String(records.find((r) => r.EventId === e.EventId)?.RelationshipTypeId ?? ""),
  })));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      toast.success((await updateOwnershipChange(landId, date, {
        date: d, docTypeId: Number(doc.docTypeId) || undefined, documentNo: doc.documentNo || undefined, deedNo: doc.deedNo || undefined,
        fileId: file?.id, transferValue: doc.value ? Number(doc.value) : undefined, remarks: doc.remarks || undefined,
        owners: owners.map((o) => ({ eventId: o.eventId, name: o.name.trim(), guardian: o.guardian.trim() || undefined, relationshipTypeId: Number(o.rel) || undefined })),
      })).message);
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 rounded-xl border border-border bg-muted/20 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className={label}>Date of change<input type="date" className={`${input} mt-1`} value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label className={label}>Document type
          <select className={`${input} mt-1`} value={doc.docTypeId} onChange={(e) => setDoc({ ...doc, docTypeId: e.target.value })}>
            <option value="">Select…</option>
            {(docTypes.data ?? []).filter((t) => t.active !== false).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className={label}>Document number<input className={`${input} mt-1`} value={doc.documentNo} onChange={(e) => setDoc({ ...doc, documentNo: e.target.value })} /></label>
        <label className={label}>Deed number<input className={`${input} mt-1`} value={doc.deedNo} onChange={(e) => setDoc({ ...doc, deedNo: e.target.value })} /></label>
        <div className={label}>Document file<div className="mt-1"><FilePick value={file} onChange={setFile} placeholder="Upload PDF / image" /></div></div>
        <label className={label}>Value (₹)<input type="number" className={`${input} mt-1`} value={doc.value} onChange={(e) => setDoc({ ...doc, value: e.target.value })} /></label>
        <label className={`${label} sm:col-span-2`}>Remarks<input className={`${input} mt-1`} value={doc.remarks} onChange={(e) => setDoc({ ...doc, remarks: e.target.value })} /></label>
      </div>
      <p className="mt-3 text-xs font-medium text-foreground">New owner(s) — shares stay as recorded</p>
      <div className="mt-2 space-y-2">
        {owners.map((o, i) => (
          <div key={o.eventId} className="grid gap-2 sm:grid-cols-[1.3fr_1.2fr_1fr_auto] sm:items-center">
            <input className={input} placeholder="Name *" value={o.name} onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className={input} placeholder="Father / husband" value={o.guardian} onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, guardian: e.target.value } : x)))} />
            <select className={input} value={o.rel} onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, rel: e.target.value } : x)))}>
              <option value="">Not related</option>
              {(rels.data ?? []).filter((t) => t.active !== false).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">{pct(evs[i]?.TransferSharePct)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.6875rem] text-muted-foreground">Saving sends this change back for verification. To change shares or who gave the land, delete the change and record it again.</p>
      <div className="mt-3 flex gap-2">
        <button className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-card disabled:opacity-50" style={{ background: LEGAL_GRADIENT }}
          disabled={busy || !d || owners.some((o) => !o.name.trim())} onClick={save}>Save changes</button>
        <button className={btn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
};

/** Current owners, the chain from the first owner to today, and the one form to extend it. */
const Chain: React.FC<StepProps> = ({ landId, onSaved }) => {
  const rights = usePageRights("legal-land-master");
  const queryClient = useQueryClient();
  const records = useQuery({ queryKey: ["legal-master", "ownership-record", landId], queryFn: () => getLegalRows("ownership-record", landId) });
  const events = useQuery({ queryKey: ["legal-master", "ownership-event", landId], queryFn: () => getLegalRows("ownership-event", landId) });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useMemo(() => (records.data ?? []).filter((r) => r.IsActive && !r.ValidTo), [records.data]);
  const total = current.reduce((s, r) => s + Number(r.SharePct ?? 0), 0);
  // The chain, oldest first: each change date with the transfers made on it.
  const changes = useMemo(() => {
    const byDate = new Map<string, LegalRow[]>();
    for (const e of (events.data ?? []).filter((x) => x.IsActive)) {
      const k = String(e.EventDate).slice(0, 10);
      byDate.set(k, [...(byDate.get(k) ?? []), e]);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events.data]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
    onSaved();
  };
  if (records.isLoading || events.isLoading) return <div className={`${stepCard} p-5 text-sm text-muted-foreground`}>Loading ownership…</div>;

  return (
    <div className="space-y-4">
      {/* Current owners */}
      <div className={`${stepCard} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={eyebrow}>Current owners</p>
          {current.length > 0 && <span className={`mb-3 text-xs ${Math.abs(total - 100) < 0.0001 ? "text-emerald-600" : "text-amber-600"}`}>Total {pct(total)}</span>}
        </div>
        {!current.length ? <p className="text-sm text-muted-foreground">No owner recorded yet. Start with the earliest owner you have a document for.</p> : (
          <div className="flex flex-wrap gap-2">
            {current.map((r) => (
              <div key={String(r.RecordId)} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
                <div className="font-medium text-foreground">{String(r.OwnerName)} · {pct(r.SharePct)}</div>
                <div className="text-xs text-muted-foreground">{r.OwnerGuardian ? `c/o ${String(r.OwnerGuardian)} · ` : ""}since {fmt(r.ValidFrom)}</div>
                <div className="mt-1"><Chip s={r.VerificationStatus} /></div>
              </div>
            ))}
          </div>
        )}
        {rights.canEdit && !adding && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-card" style={{ background: LEGAL_GRADIENT }} onClick={() => setAdding(true)}>
              <Plus size={13} /> {current.length ? "Record ownership change" : "Add first owner"}
            </button>
          </div>
        )}
      </div>

      {adding && <ChangeForm landId={landId} current={current} onSaved={refresh} onDone={() => setAdding(false)} />}

      {/* The chain */}
      <div className={`${stepCard} p-4 sm:p-5`}>
        <p className={eyebrow}>Ownership chain — earliest to today</p>
        {!changes.length ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : (
          <ol className="relative ml-2 border-l border-border">
            {changes.map(([d, evs], idx) => (
              <li key={d} className="mb-5 ml-5 last:mb-0">
                <span className="absolute -left-[7px] mt-1 rounded-full bg-card"><Circle size={13} className="fill-[#7c4a2e] text-[#7c4a2e]" /></span>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-foreground">{fmt(d)}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{String(evs[0].TransferTypeId__label ?? "")}</span>
                  {rights.canEdit && !evs.some((e) => e.RegisteredDeedId) && (
                    <span className="ml-auto flex gap-1.5">
                      <button className={btn} onClick={() => setEditing(editing === d ? null : d)}><Pencil size={12} /> Edit</button>
                      {/* Only the latest change can be deleted, so the chain never breaks in the middle. */}
                      {idx === changes.length - 1 && (
                        <button className={`${btn} text-rose-600`} disabled={busy} onClick={async () => {
                          if (!(await askLegal({ title: `Delete the change of ${fmt(d)}?`, message: "Its new owners are removed and the previous owners become current again.", confirmText: "Delete change", tone: "danger" }))) return;
                          setBusy(true);
                          try { toast.success((await undoOwnershipChange(landId)).message); await refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); } finally { setBusy(false); }
                        }}><Trash2 size={12} /> Delete</button>
                      )}
                    </span>
                  )}
                </div>
                {editing === d && (
                  <EditChange landId={landId} date={d} evs={evs} records={records.data ?? []} onClose={() => setEditing(null)} onSaved={refresh} />
                )}
                <div className="mt-1.5 grid gap-2 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-start">
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">From</div>
                    <div className="text-foreground">{String(evs[0].PreviousOwnerName || "Earliest documented owner")}</div>
                    {evs[0].PreviousOwnerGuardian ? <div className="text-xs text-muted-foreground">c/o {String(evs[0].PreviousOwnerGuardian)}</div> : null}
                  </div>
                  <ArrowRight size={15} className="mx-auto hidden text-muted-foreground sm:mt-5 sm:block" />
                  <div className="space-y-1.5">
                    {evs.map((e) => (
                      <div key={String(e.EventId)} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">To</div>
                        <div className="flex flex-wrap items-center gap-2 text-foreground">{String(e.NewOwnerName ?? "")}
                          {e.TransferSharePct != null && <span className="text-xs text-muted-foreground">{pct(e.TransferSharePct)}</span>}
                          <Chip s={e.VerificationStatus} />
                        </div>
                        {e.NewOwnerGuardian ? <div className="text-xs text-muted-foreground">c/o {String(e.NewOwnerGuardian)}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {evs[0].DocTypeId ? <span>{String(evs[0].DocTypeId__label)}{evs[0].DocumentNo ? ` ${String(evs[0].DocumentNo)}` : ""}</span> : evs[0].DocumentNo ? <span>Doc {String(evs[0].DocumentNo)}</span> : null}
                  {evs[0].DeedNo && evs[0].DeedNo !== evs[0].DocumentNo ? <span>· Deed {String(evs[0].DeedNo)}</span> : null}
                  {evs[0].RegistrationOfficeId ? <span>· {String(evs[0].RegistrationOfficeId__label)}</span> : null}
                </div>
                {evs[0].DocFileId ? <div className="mt-1.5"><LegalFileLink id={evs[0].DocFileId} name={String(evs[0].DocFileId__label ?? "")} /></div>
                  : <div className="mt-1.5 text-xs text-amber-600">No document attached</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

export const OwnershipStep: React.FC<StepProps> = (p) => (
  <StepTabs {...p} tabs={[
    { key: "chain", label: "Ownership chain", content: <Chain {...p} /> },
    {
      key: "verify", label: "Verification",
      note: "Reviewer: verify each transfer and ownership record, and give every ownership record its seven checks (Verified or Not Applicable).",
      tables: [
        { key: "ownership-event", label: "Transfers to verify", noAdd: true },
        { key: "ownership-record", label: "Ownership records to verify", noAdd: true },
        { key: "ownership-check", label: "Seven checks per ownership record" },
        { key: "inheritance", label: "Inheritances to verify", noAdd: true },
      ],
    },
    {
      key: "corrections", label: "Corrections",
      note: "Only to correct a typing mistake. Normal entries are made from Ownership chain, which keeps dates and shares consistent.",
      tables: [
        { key: "inheritance-heir", label: "Legal Heirs", noAdd: true },
        { key: "partition", label: "Partitions", noAdd: true },
      ],
    },
  ]} />
);
