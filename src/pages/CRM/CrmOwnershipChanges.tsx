import { useSheetAsk } from "@/components/sheet/SheetAsk";
import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Check, ExternalLink, FileText, History, Info, Plus, RefreshCw, Upload, Users } from "lucide-react";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";
import { localDay } from "./salesDeed/config";
import { useCanApprove } from "@/hooks/useCanApprove";

// Ownership Changes — after a property's sale deed is registered it is its
// owner's; if they sell it on, the sale is between owners and we only RECORD
// the new owner from their own registered sale deed. Once approved, the booking moves to the new owner, so
// maintenance, service tickets and the portal follow them. Before conveyance
// a change of owner is a resale (Cases), not this.

const API = "/api/crm/ownership-changes";
const fmtMoney = (n: any) => (n == null ? "—" : fmtRupees(Number(n)));
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

const STATUS: Record<string, string> = {
  Draft: "Being prepared", Pending: "Waiting for approval", Rejected: "Sent back", Approved: "Owner changed", Cancelled: "Cancelled",
};
const tone = (s: string): "done" | "waiting" | "stopped" | "none" => (s === "Approved" ? "done" : s === "Rejected" ? "stopped" : s === "Cancelled" ? "none" : "waiting");
const Mark = ({ s }: { s: string }) => tone(s) === "none"
  ? <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground line-through">{STATUS[s] || s}</span>
  : <SheetMark text={STATUS[s] || s} tone={tone(s) as "done" | "waiting" | "stopped"} />;
const head = "px-4 py-2.5 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5";

async function send(method: string, url: string, body?: any) {
  const r = await fetchWithAuth(url, body instanceof FormData ? { method, body } : { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong");
  return j;
}

const label = `block mb-1 ${LBL}`;
const input = INP;

/** New record: the conveyed property and its new owner. The rest is filled on the record. */
function NewDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const [bookingId, setBookingId] = useState("");
  const [toId, setToId] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: bookings = [] } = useQuery<any[]>({ queryKey: ["crm-ownership-eligible"], queryFn: () => send("GET", `${API}/eligible-bookings`), enabled: open });
  const { data: customers = [] } = useQuery<any[]>({ queryKey: ["crm-customers-dropdown"], queryFn: () => send("GET", "/api/crm/customers"), enabled: open, staleTime: 60_000 });
  const chosen = bookings.find((b) => String(b.BookingId) === bookingId);
  useEffect(() => { if (!open) { setBookingId(""); setToId(""); } }, [open]);
  const create = async () => {
    if (!bookingId) return toast.error("Choose the property");
    if (!toId) return toast.error("Choose the new owner");
    setBusy(true);
    try { const r = await send("POST", API, { BookingId: Number(bookingId), ToCustomerId: Number(toId) }); onCreated(r.Id); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-none p-5 gap-4" style={{ border: RULE }}>
        <DialogHeader><DialogTitle className="font-heading">Record a new owner</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground flex gap-2"><Info size={14} className="shrink-0 mt-0.5" />
            Only properties whose sale deed is registered are listed. Before that, a change of owner is a resale — open a case in Resale → Resale Cases.</p>
          <div>
            <label className={label}>Property</label>
            <SearchableSelect sheet value={bookingId} onChange={setBookingId} placeholder="Choose the property" searchPlaceholder="Search booking, unit or owner…"
              options={bookings.filter((b) => !b.OpenChangeNo).map((b) => ({ value: String(b.BookingId), label: `${b.Property} · ${b.BookingNo} · ${b.CustomerName}${b.ProjectName ? ` · ${b.ProjectName}` : ""}` }))} />
            {bookings.some((b) => b.OpenChangeNo) && <p className="mt-1 text-[0.6875rem] text-muted-foreground">Properties with a record already open aren't listed.</p>}
          </div>
          {chosen && <div className="p-3 text-xs" style={{ border: RULE_SOFT }}>Current owner: <b>{chosen.CustomerName}</b>{chosen.Mobile ? ` · ${chosen.Mobile}` : ""}</div>}
          <div>
            <label className={label}>New owner</label>
            <SearchableSelect sheet value={toId} onChange={setToId} placeholder="Choose the new owner" searchPlaceholder="Search name, mobile or customer no…"
              options={customers.filter((c: any) => !chosen || c.Id !== chosen.CustomerId).map((c: any) => ({ value: String(c.Id), label: [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · ") }))} />
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">Not listed? Add them in <a href="/crm/customers" target="_blank" rel="noreferrer" className="underline underline-offset-2">Customers</a> first.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Close</button>
          <button onClick={create} disabled={busy} className={`${KEY_INK} h-9 px-4`}>{busy ? "Creating…" : "Create"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ id, canEdit, onChanged }: { id: number; canEdit: boolean; onChanged: () => void }) {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const { data: o, isLoading } = useQuery<any>({ queryKey: ["crm-ownership-change", id], queryFn: () => send("GET", `${API}/${id}`) });
  const { data: customers = [] } = useQuery<any[]>({ queryKey: ["crm-customers-dropdown"], queryFn: () => send("GET", "/api/crm/customers"), staleTime: 60_000 });
  const { data: log = [] } = useQuery<any[]>({ queryKey: ["crm-ownership-change-log", id], queryFn: () => send("GET", `${API}/${id}/history`) });
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (o) setF({ ToCustomerId: String(o.ToCustomerId || ""), DeedNo: o.DeedNo || "", DeedDate: o.DeedDate ? String(o.DeedDate).slice(0, 10) : "", RegOffice: o.RegOffice || "", ConsiderationValue: o.ConsiderationValue ?? "", Notes: o.Notes || "" });
  }, [o]);
  // Approval Setup ("Ownership Change") names who approves this record now; a super admin always can.
  const canApprove = useCanApprove("crm-ownership-changes", id, o?.Status === "Pending");
  if (isLoading || !o || !f) return <div className="bg-card p-10 text-center text-sm text-muted-foreground" style={{ border: RULE }}>Loading…</div>;
  const editable = canEdit && ["Draft", "Rejected"].includes(o.Status);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["crm-ownership-change", id] }); qc.invalidateQueries({ queryKey: ["crm-ownership-change-log", id] }); onChanged(); };
  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); setNote(""); refresh(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(""); }
  };
  const save = () => run("save", () => send("PUT", `${API}/${id}`, { ...f, ToCustomerId: f.ToCustomerId ? Number(f.ToCustomerId) : null }), "Saved");
  const uploadDeed = (file: File) => { const fd = new FormData(); fd.append("file", file); return run("upload", () => send("POST", `${API}/${id}/deed`, fd), "Sale deed copy attached"); };
  const openDeed = async () => {
    const r = await fetchWithAuth(`${API}/${id}/deed`);
    if (!r.ok) return toast.error("Couldn't open the deed copy");
    const u = URL.createObjectURL(await r.blob());
    window.open(u, "_blank");
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  };
  const dirty = f.ToCustomerId !== String(o.ToCustomerId || "") || f.DeedNo !== (o.DeedNo || "") || f.DeedDate !== (o.DeedDate ? String(o.DeedDate).slice(0, 10) : "")
    || f.RegOffice !== (o.RegOffice || "") || String(f.ConsiderationValue ?? "") !== String(o.ConsiderationValue ?? "") || f.Notes !== (o.Notes || "");
  // [what, done, where to fix it]
  const kyc = o.ToCustomerId ? `/crm/customers?customerId=${o.ToCustomerId}` : undefined;
  const checks: [string, boolean, string?][] = [
    ["New owner chosen", !!o.ToCustomerId],
    ["New owner's PAN on file", !!o.ToPan, kyc],
    // An individual's PAN has P as its 4th letter; a company / firm has no Aadhaar.
    ...(!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(o.ToPan || "").toUpperCase()) || String(o.ToPan).toUpperCase()[3] === "P"
      ? [["New owner's Aadhaar on file", !!o.ToAadhaar, kyc] as [string, boolean, string?]] : []),
    ["New owner's address on file", !!o.ToAddress, kyc],
    ["New owner's application opened (co-owners go on it)", !!o.ToApplicationId],
    ["Sale deed's registration number", !!o.DeedNo],
    ["Sale deed's date", !!o.DeedDate],
    ["Registration office", !!o.RegOffice],
    ["Copy of the registered sale deed", !!o.FileName],
  ];
  const ready = checks.every(([, ok]) => ok);

  const banner =
    o.Status === "Approved" ? `${o.ToName} is now the owner — since ${fmtDate(o.ApprovedAt)}. Maintenance, service tickets and the portal follow them.`
    : o.Status === "Pending" ? "Waiting for approval — here or in the Approval Inbox."
    : o.Status === "Cancelled" ? `Cancelled — ${o.RejectionNote || ""}`
    : o.Status === "Rejected" ? `Sent back: ${o.RejectionNote || "—"}. Fix it and send it again.`
    : ready ? "Everything is in — send it for approval." : "Complete the list on the right — the new owner's KYC and application, the sale deed's details and its registered copy — then send it for approval.";

  return (
    <div className="space-y-4">
      <div className="bg-card p-4" style={{ border: RULE }}>
      {ask.node}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className={`block ${LBL}`}>Ownership change</span>
            <h2 className="font-heading font-bold text-lg leading-tight mt-0.5">{o.Property}{o.ProjectName ? <span className="font-normal text-muted-foreground"> · {o.ProjectName}</span> : null}</h2>
            <div className="text-[0.6875rem] text-muted-foreground tabular-nums mt-0.5">{o.ChangeNo} · {o.BookingNo}</div>
            <div className="text-sm mt-1.5">{o.FromName} <span className="text-muted-foreground">→</span> {o.ToName || "—"}</div>
          </div>
          <Mark s={o.Status} />
        </div>
        <p className={`mt-3 text-sm px-3 py-2.5 ${o.Status === "Rejected" ? "text-destructive" : ""}`}
          style={{ border: RULE_SOFT, borderLeft: `3px solid ${o.Status === "Rejected" ? "hsl(var(--destructive))" : o.Status === "Approved" || o.Status === "Cancelled" ? "hsl(var(--foreground) / 0.3)" : "hsl(var(--foreground))"}` }}>{banner}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="bg-card" style={{ border: RULE }}>
          <h3 className={head} style={{ borderBottom: RULE }}>The new owner's sale deed</h3>
          <div className="p-4 space-y-3">
          <div>
            <label className={label}>New owner</label>
            {editable ? (
              <SearchableSelect sheet value={f.ToCustomerId} onChange={(v) => setF({ ...f, ToCustomerId: v })} placeholder="Choose the new owner" searchPlaceholder="Search name, mobile or customer no…"
                options={customers.filter((c: any) => c.Id !== o.FromCustomerId).map((c: any) => ({ value: String(c.Id), label: [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · ") }))} />
            ) : <div className="text-sm">{o.ToName}{o.ToMobile ? ` · ${o.ToMobile}` : ""}</div>}
            {editable && o.ToApplicationId && <p className="mt-1 text-[0.6875rem] text-muted-foreground">Their application is open, so the new owner is fixed — cancel this record to name someone else.</p>}
          </div>
          <div className="p-3 flex flex-wrap items-center gap-2 text-xs" style={{ border: RULE_SOFT }}>
            <Users size={14} className="text-muted-foreground" />
            {o.ToApplicationId ? (
              <>
                <span className="flex-1">Application <b className="tabular-nums">{o.ToApplicationNo}</b> · {o.CoOwnerCount ? `${o.CoOwnerCount} co-owner${o.CoOwnerCount > 1 ? "s" : ""}` : "no co-owners"}</span>
                <Link to={`/crm/applications?id=${o.ToApplicationId}`} target="_blank" className={`${KEY_LINE} h-7 px-2.5`}>Add co-owners / KYC <ExternalLink size={11} /></Link>
              </>
            ) : (
              <>
                <span className="flex-1 text-muted-foreground">The new owner's application takes the property when this is approved. Open it to add any co-owners named on the sale deed.</span>
                {editable && <button disabled={!!busy || dirty} title={dirty ? "Save your changes first" : undefined}
                  onClick={() => run("app", () => send("PUT", `${API}/${id}/owner-application`), "Application opened")}
                  className={`${KEY_INK} h-7 px-2.5`}>{busy === "app" ? "Opening…" : "Open application"}</button>}
              </>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label}>Registration number</label>
              <input disabled={!editable} value={f.DeedNo} onChange={(e) => setF({ ...f, DeedNo: e.target.value })} placeholder="e.g. I-1902-04567/2026" className={input} /></div>
            <div><label className={label}>Date registered</label>
              <DateInput disabled={!editable} max={localDay()} value={f.DeedDate} onChange={(e: any) => setF({ ...f, DeedDate: e.target.value })} className={input} /></div>
            <div><label className={label}>Registration office</label>
              <input disabled={!editable} value={f.RegOffice} onChange={(e) => setF({ ...f, RegOffice: e.target.value })} placeholder="Sub-Registrar's office" className={input} /></div>
            <div><label className={label}>Sale value (as on the deed, optional)</label>
              <input disabled={!editable} type="number" min={0} value={f.ConsiderationValue} onChange={(e) => setF({ ...f, ConsiderationValue: e.target.value })} className={`${input} tabular-nums`} /></div>
          </div>
          <div><label className={label}>Notes</label>
            <textarea disabled={!editable} value={f.Notes} onChange={(e) => setF({ ...f, Notes: e.target.value })} rows={2} className={TEXTAREA} /></div>
          <div className="flex flex-wrap items-center gap-2">
            {o.FileName ? (
              <button onClick={openDeed} className={`${KEY_LINE} h-9 px-3 normal-case tracking-normal font-sans text-xs`}><FileText size={14} />{o.FileName}</button>
            ) : <span className="text-xs text-muted-foreground">No deed copy attached yet.</span>}
            {editable && (
              <label className={`${KEY_LINE} h-9 px-3 cursor-pointer`}>
                <Upload size={14} />{busy === "upload" ? "Uploading…" : o.FileName ? "Replace copy" : "Attach registered copy"}
                <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) uploadDeed(x); }} />
              </label>
            )}
            {editable && <button onClick={save} disabled={!dirty || !!busy} className={`${KEY_INK} h-9 px-4 ml-auto`}>{busy === "save" ? "Saving…" : "Save"}</button>}
          </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="bg-card" style={{ border: RULE }}>
            <h3 className={head} style={{ borderBottom: RULE }}>Before it goes for approval</h3>
            <div className="p-4">
            <ul className="space-y-2">
              {checks.map(([t, ok, to]) => (
                <li key={t} className={`flex items-center gap-2 text-xs ${ok ? "" : "text-muted-foreground"}`}>
                  {ok ? <span className="w-4 h-4 shrink-0 bg-foreground text-card grid place-items-center"><Check size={10} /></span> : <span className="w-4 h-4 shrink-0 border-2 border-foreground/50" />}
                  <span className="flex-1">{t}</span>
                  {!ok && to && <Link to={to} target="_blank" className="underline underline-offset-2 inline-flex items-center gap-0.5">Fix <ExternalLink size={10} /></Link>}
                </li>
              ))}
            </ul>
            {editable && (
              <button disabled={!ready || dirty || !!busy} title={dirty ? "Save your changes first" : undefined}
                onClick={() => run("submit", () => send("PUT", `${API}/${id}/submit`), "Sent for approval")}
                className={`${KEY_INK} mt-3 w-full h-9`}>{busy === "submit" ? "Sending…" : o.Status === "Rejected" ? "Send again" : "Send for approval"}</button>
            )}
            </div>
          </div>
          {canEdit && ["Draft", "Rejected", "Pending"].includes(o.Status) && (
            <div className="bg-card" style={{ border: RULE }}>
              <h3 className={head} style={{ borderBottom: RULE }}>{o.Status === "Pending" ? "Approve or send back" : "Cancel"}</h3>
              <div className="p-4 space-y-2">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={o.Status === "Pending" ? "Remarks (needed to send back)" : "Why it is being cancelled"} className={TEXTAREA} />
              {o.Status === "Pending" && canApprove && (
                <div className="flex gap-2">
                  <button disabled={!!busy} onClick={() => run("approve", () => send("PUT", `${API}/${id}/approve`, { note }), "Approved")} className={`${KEY_INK} flex-1 h-9`}>Approve</button>
                  <button disabled={!!busy || !note.trim()} onClick={() => run("reject", () => send("PUT", `${API}/${id}/reject`, { note }), "Sent back")} className={`${KEY_LINE} flex-1 h-9`}>Send back</button>
                </div>
              )}
              <button disabled={!!busy || !note.trim()} onClick={async () => { if (await ask.confirm(`Cancel ${o.ChangeNo}?`, { okLabel: "Cancel record", cancelLabel: "Keep it", danger: true })) run("cancel", () => send("PUT", `${API}/${id}/cancel`, { note }), "Cancelled"); }} className={`${KEY_RED} w-full h-8`}>Cancel this record</button>
              </div>
            </div>
          )}
          <div className="bg-card p-4 text-xs space-y-1.5" style={{ border: RULE }}>
            <div className="flex justify-between"><span className="text-muted-foreground">Entered by</span><span>{o.CreatedByName || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">On</span><span>{fmtDate(o.CreatedAt)}</span></div>
            {o.SubmittedAt && <div className="flex justify-between"><span className="text-muted-foreground">Sent for approval</span><span>{fmtDate(o.SubmittedAt)}</span></div>}
            {o.ApprovedAt && <div className="flex justify-between"><span className="text-muted-foreground">Approved by</span><span>{o.ApprovedByName || "—"}</span></div>}
            {o.ConsiderationValue != null && <div className="flex justify-between"><span className="text-muted-foreground">Sale value</span><span className="font-heading tabular-nums">{fmtMoney(o.ConsiderationValue)}</span></div>}
          </div>
        </aside>
      </div>

      <div className="bg-card" style={{ border: RULE }}>
        <h3 className={head} style={{ borderBottom: RULE }}><History size={13} />History</h3>
        {!log.length ? <p className="p-4 text-xs text-muted-foreground">Nothing recorded yet.</p> : (
          <ol>
            {log.map((l) => (
              <li key={l.Id} className="flex gap-3 text-xs px-4 py-2.5" style={{ borderBottom: RULE_SOFT }}>
                <span className="text-muted-foreground tabular-nums shrink-0 w-36">{new Date(l.CreatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <span className="flex-1"><b className="font-medium">{l.Action}</b>{l.Remarks ? <span className="text-muted-foreground"> — {l.Remarks}</span> : null}</span>
                <span className="text-muted-foreground shrink-0">{l.UserName || ""}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

const CrmOwnershipChanges: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-ownership-changes");
  const [sp, setSp] = useSearchParams();
  const selected = sp.get("id") ? Number(sp.get("id")) : null;
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, isError, error, isFetching } = useQuery<any[]>({ queryKey: ["crm-ownership-changes"], queryFn: () => send("GET", API) });
  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return t ? data.filter((d) => [d.ChangeNo, d.Property, d.BookingNo, d.FromName, d.ToName, d.DeedNo].some((v) => String(v || "").toLowerCase().includes(t))) : data;
  }, [data, search]);
  const pick = (id: number) => setSp((p) => { p.set("id", String(id)); return p; }, { replace: true });
  const reload = () => qc.invalidateQueries({ queryKey: ["crm-ownership-changes"] });

  const counts = (st: string) => data.filter((d) => d.Status === st).length;
  const figures = [
    { label: "Records", value: data.length, note: "New owners after conveyance" },
    { label: "Being prepared", value: counts("Draft") + counts("Rejected"), note: `${counts("Rejected")} sent back` },
    { label: "Waiting", value: counts("Pending"), note: "In the Approval Inbox" },
    { label: "Owner changed", value: counts("Approved"), note: `${counts("Cancelled")} cancelled` },
  ];

  return (
    <>
      <Breadcrumbs items={["CRM", "Resale", "Ownership Changes"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Resale"
        title="Ownership Changes"
        subtitle="A new owner after the sale deed is registered, recorded from their own registered sale deed. Once approved, the booking — with its maintenance, tickets and portal — moves to them."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={reload} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => setCreating(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Record a new owner</button>}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <span className="label">{x.label}</span>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
            <aside className="bg-card" style={{ border: RULE }}>
              <div className="p-3" style={{ borderBottom: RULE }}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Property, owner, deed no…"
                  className="h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              </div>
              {isError ? <p className="p-4 text-center text-sm text-destructive">{(error as Error)?.message}</p>
                : isLoading ? <p className="p-4 text-center text-sm text-muted-foreground">Loading…</p>
                : !list.length ? <p className="p-4 text-center text-sm text-muted-foreground">{data.length ? "No record matches." : "No ownership changes yet."}</p>
                : (
                  <ul className="max-h-[70vh] overflow-y-auto thin-scroll">
                    {list.map((d) => {
                      const on = selected === d.Id;
                      return (
                        <li key={d.Id}>
                          <button onClick={() => pick(d.Id)} className={`w-full text-left px-3 py-2.5 transition-colors ${on ? "bg-foreground text-card" : "hover:bg-primary/5"}`} style={{ borderBottom: RULE_SOFT }}>
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-semibold leading-tight truncate">{d.FromName}<span className="font-normal opacity-70"> → {d.ToName}</span></span>
                              <span className={on ? "[&_*]:!text-card" : ""}><Mark s={d.Status} /></span>
                            </div>
                            <div className={`mt-1 text-[0.6875rem] tabular-nums truncate ${on ? "opacity-80" : "text-muted-foreground"}`}>{d.ChangeNo} · {d.Property}</div>
                            <div className={`mt-0.5 text-[0.6875rem] truncate ${on ? "opacity-80" : "text-muted-foreground"}`}>{d.DeedNo ? `Sale deed ${d.DeedNo}` : "Sale deed details not in yet"}</div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </aside>
            <main className="min-w-0">
              {selected ? <Detail key={selected} id={selected} canEdit={rights.canEdit} onChanged={reload} />
                : <div className="bg-card p-10 text-center text-sm text-muted-foreground" style={{ border: RULE }}>Choose a record, or record a new owner.</div>}
            </main>
          </div>
        </div>
        <NewDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); reload(); pick(id); }} />
      </SheetShell>
    </>
  );
};

export default CrmOwnershipChanges;
