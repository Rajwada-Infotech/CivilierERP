import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CheckCircle2, Circle, ExternalLink, FileText, History, Info, Plus, Search, Upload, Users } from "lucide-react";

// Ownership Changes — after a property's sale deed is registered it is its
// owner's; if they sell it on, the sale is between owners and we only RECORD
// the new owner from their own registered sale deed. Approved (by someone
// other than whoever entered it), the booking moves to the new owner, so
// maintenance, service tickets and the portal follow them. Before conveyance
// a change of owner is a resale (Cases), not this.

const API = "/api/crm/ownership-changes";
const fmtMoney = (n: any) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const fmtDate = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

const STATUS: Record<string, [string, string]> = {
  Draft: ["Being prepared", "bg-muted text-muted-foreground border-border"],
  Pending: ["Waiting for approval", "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900"],
  Rejected: ["Sent back", "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900"],
  Approved: ["Owner changed", "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900"],
  Cancelled: ["Cancelled", "bg-muted text-muted-foreground border-border line-through"],
};

async function send(method: string, url: string, body?: any) {
  const r = await fetchWithAuth(url, body instanceof FormData ? { method, body } : { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong");
  return j;
}

const label = "block text-xs font-medium text-muted-foreground mb-1";
const input = "w-full h-9 px-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30";

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
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Record a new owner</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground flex gap-2"><Info size={14} className="shrink-0 mt-0.5" />
            Only properties whose sale deed is registered are listed. Before that, a change of owner is a resale — open a case in Resale → Resale Cases.</p>
          <div>
            <label className={label}>Property</label>
            <SearchableSelect value={bookingId} onChange={setBookingId} placeholder="Choose the property" searchPlaceholder="Search booking, unit or owner…"
              options={bookings.filter((b) => !b.OpenChangeNo).map((b) => ({ value: String(b.BookingId), label: `${b.Property} · ${b.BookingNo} · ${b.CustomerName}${b.ProjectName ? ` · ${b.ProjectName}` : ""}` }))} />
            {bookings.some((b) => b.OpenChangeNo) && <p className="mt-1 text-[0.6875rem] text-muted-foreground">Properties with a record already open aren't listed.</p>}
          </div>
          {chosen && <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">Current owner: <b>{chosen.CustomerName}</b>{chosen.Mobile ? ` · ${chosen.Mobile}` : ""}</div>}
          <div>
            <label className={label}>New owner</label>
            <SearchableSelect value={toId} onChange={setToId} placeholder="Choose the new owner" searchPlaceholder="Search name, mobile or customer no…"
              options={customers.filter((c: any) => !chosen || c.Id !== chosen.CustomerId).map((c: any) => ({ value: String(c.Id), label: [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · ") }))} />
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">Not listed? Add them in <a href="/crm/customers" target="_blank" rel="noreferrer" className="text-primary hover:underline">Customers</a> first.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="h-9 px-4 text-sm rounded-lg border border-border hover:bg-muted">Close</button>
            <button onClick={create} disabled={busy} className="h-9 px-4 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-50">{busy ? "Creating…" : "Create"}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Detail({ id, canEdit, onChanged }: { id: number; canEdit: boolean; onChanged: () => void }) {
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
  if (isLoading || !o || !f) return <div className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground">Loading…</div>;
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
    window.open(URL.createObjectURL(await r.blob()), "_blank");
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
  const s = STATUS[o.Status] || [o.Status, ""];

  const banner =
    o.Status === "Approved" ? `${o.ToName} is now the owner — since ${fmtDate(o.ApprovedAt)}. Maintenance, service tickets and the portal follow them.`
    : o.Status === "Pending" ? "Waiting for approval in the Approval Inbox. Whoever entered it can't approve it."
    : o.Status === "Cancelled" ? `Cancelled — ${o.RejectionNote || ""}`
    : o.Status === "Rejected" ? `Sent back: ${o.RejectionNote || "—"}. Fix it and send it again.`
    : ready ? "Everything is in — send it for approval." : "Complete the list on the right — the new owner's KYC and application, the sale deed's details and its registered copy — then send it for approval.";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-mono text-muted-foreground">{o.ChangeNo} · {o.BookingNo}</div>
            <h2 className="text-lg font-semibold mt-0.5">{o.Property}{o.ProjectName ? <span className="font-normal text-muted-foreground"> · {o.ProjectName}</span> : null}</h2>
            <div className="text-sm mt-1">{o.FromName} <span className="text-muted-foreground">→</span> {o.ToName || "—"}</div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${s[1]}`}>{s[0]}</span>
        </div>
        <p className="mt-3 text-sm rounded-lg bg-muted/40 px-3 py-2">{banner}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold">The new owner's sale deed</h3>
          <div>
            <label className={label}>New owner</label>
            {editable ? (
              <SearchableSelect value={f.ToCustomerId} onChange={(v) => setF({ ...f, ToCustomerId: v })} placeholder="Choose the new owner" searchPlaceholder="Search name, mobile or customer no…"
                options={customers.filter((c: any) => c.Id !== o.FromCustomerId).map((c: any) => ({ value: String(c.Id), label: [c.CustomerName, c.Mobile, c.CustomerNo].filter(Boolean).join(" · ") }))} />
            ) : <div className="text-sm">{o.ToName}{o.ToMobile ? ` · ${o.ToMobile}` : ""}</div>}
            {editable && o.ToApplicationId && <p className="mt-1 text-[0.6875rem] text-muted-foreground">Their application is open, so the new owner is fixed — cancel this record to name someone else.</p>}
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 flex flex-wrap items-center gap-2 text-xs">
            <Users size={14} className="text-muted-foreground" />
            {o.ToApplicationId ? (
              <>
                <span className="flex-1">Application <b className="font-mono">{o.ToApplicationNo}</b> · {o.CoOwnerCount ? `${o.CoOwnerCount} co-owner${o.CoOwnerCount > 1 ? "s" : ""}` : "no co-owners"}</span>
                <Link to={`/crm/applications?id=${o.ToApplicationId}`} target="_blank" className="h-7 px-2.5 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1">Add co-owners / KYC <ExternalLink size={11} /></Link>
              </>
            ) : (
              <>
                <span className="flex-1 text-muted-foreground">The new owner's application takes the property when this is approved. Open it to add any co-owners named on the sale deed.</span>
                {editable && <button disabled={!!busy || dirty} title={dirty ? "Save your changes first" : undefined}
                  onClick={() => run("app", () => send("PUT", `${API}/${id}/owner-application`), "Application opened")}
                  className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground disabled:opacity-40">{busy === "app" ? "Opening…" : "Open application"}</button>}
              </>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label}>Registration number</label>
              <input disabled={!editable} value={f.DeedNo} onChange={(e) => setF({ ...f, DeedNo: e.target.value })} placeholder="e.g. I-1902-04567/2026" className={input} /></div>
            <div><label className={label}>Date registered</label>
              <DateInput disabled={!editable} value={f.DeedDate} onChange={(e: any) => setF({ ...f, DeedDate: e.target.value })} className={input} /></div>
            <div><label className={label}>Registration office</label>
              <input disabled={!editable} value={f.RegOffice} onChange={(e) => setF({ ...f, RegOffice: e.target.value })} placeholder="Sub-Registrar's office" className={input} /></div>
            <div><label className={label}>Sale value (as on the deed, optional)</label>
              <input disabled={!editable} type="number" min={0} value={f.ConsiderationValue} onChange={(e) => setF({ ...f, ConsiderationValue: e.target.value })} className={input} /></div>
          </div>
          <div><label className={label}>Notes</label>
            <textarea disabled={!editable} value={f.Notes} onChange={(e) => setF({ ...f, Notes: e.target.value })} rows={2} className={`${input} h-auto py-2`} /></div>
          <div className="flex flex-wrap items-center gap-2">
            {o.FileName ? (
              <button onClick={openDeed} className="h-9 px-3 text-sm rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5"><FileText size={14} />{o.FileName}</button>
            ) : <span className="text-xs text-muted-foreground">No deed copy attached yet.</span>}
            {editable && (
              <label className="h-9 px-3 text-sm rounded-lg border border-border hover:bg-muted inline-flex items-center gap-1.5 cursor-pointer">
                <Upload size={14} />{busy === "upload" ? "Uploading…" : o.FileName ? "Replace copy" : "Attach registered copy"}
                <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x) uploadDeed(x); }} />
              </label>
            )}
            {editable && <button onClick={save} disabled={!dirty || !!busy} className="h-9 px-4 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-40 ml-auto">{busy === "save" ? "Saving…" : "Save"}</button>}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold mb-2">Before it goes for approval</h3>
            <ul className="space-y-1.5">
              {checks.map(([t, ok, to]) => (
                <li key={t} className={`flex items-center gap-2 text-xs ${ok ? "" : "text-muted-foreground"}`}>
                  {ok ? <CheckCircle2 size={14} className="text-green-600 shrink-0" /> : <Circle size={14} className="shrink-0" />}
                  <span className="flex-1">{t}</span>
                  {!ok && to && <Link to={to} target="_blank" className="text-primary hover:underline inline-flex items-center gap-0.5">Fix <ExternalLink size={10} /></Link>}
                </li>
              ))}
            </ul>
            {editable && (
              <button disabled={!ready || dirty || !!busy} title={dirty ? "Save your changes first" : undefined}
                onClick={() => run("submit", () => send("PUT", `${API}/${id}/submit`), "Sent for approval")}
                className="mt-3 w-full h-9 text-sm rounded-lg bg-primary text-primary-foreground disabled:opacity-40">{busy === "submit" ? "Sending…" : o.Status === "Rejected" ? "Send again" : "Send for approval"}</button>
            )}
          </div>
          {canEdit && ["Draft", "Rejected", "Pending"].includes(o.Status) && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold">{o.Status === "Pending" ? "Approve or send back" : "Cancel"}</h3>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={o.Status === "Pending" ? "Remarks (needed to send back)" : "Why it is being cancelled"} className={`${input} h-auto py-2`} />
              {o.Status === "Pending" && (
                <div className="flex gap-2">
                  <button disabled={!!busy} onClick={() => run("approve", () => send("PUT", `${API}/${id}/approve`, { note }), "Approved")} className="flex-1 h-9 text-sm rounded-lg bg-green-600 text-white disabled:opacity-40">Approve</button>
                  <button disabled={!!busy || !note.trim()} onClick={() => run("reject", () => send("PUT", `${API}/${id}/reject`, { note }), "Sent back")} className="flex-1 h-9 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-40">Send back</button>
                </div>
              )}
              <button disabled={!!busy || !note.trim()} onClick={() => run("cancel", () => send("PUT", `${API}/${id}/cancel`, { note }), "Cancelled")} className="w-full h-8 text-xs rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40">Cancel this record</button>
            </div>
          )}
          <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Entered by</span><span>{o.CreatedByName || "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">On</span><span>{fmtDate(o.CreatedAt)}</span></div>
            {o.SubmittedAt && <div className="flex justify-between"><span className="text-muted-foreground">Sent for approval</span><span>{fmtDate(o.SubmittedAt)}</span></div>}
            {o.ApprovedAt && <div className="flex justify-between"><span className="text-muted-foreground">Approved by</span><span>{o.ApprovedByName || "—"}</span></div>}
            {o.ConsiderationValue != null && <div className="flex justify-between"><span className="text-muted-foreground">Sale value</span><span className="tabular-nums">{fmtMoney(o.ConsiderationValue)}</span></div>}
          </div>
        </aside>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3 inline-flex items-center gap-1.5"><History size={14} />History</h3>
        {!log.length ? <p className="text-xs text-muted-foreground">Nothing recorded yet.</p> : (
          <ol className="space-y-2">
            {log.map((l) => (
              <li key={l.Id} className="flex gap-3 text-xs">
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
  const { data = [], isLoading, dataUpdatedAt, isFetching } = useQuery<any[]>({ queryKey: ["crm-ownership-changes"], queryFn: () => send("GET", API) });
  const list = useMemo(() => {
    const t = search.trim().toLowerCase();
    return t ? data.filter((d) => [d.ChangeNo, d.Property, d.BookingNo, d.FromName, d.ToName, d.DeedNo].some((v) => String(v || "").toLowerCase().includes(t))) : data;
  }, [data, search]);
  const pick = (id: number) => setSp((p) => { p.set("id", String(id)); return p; }, { replace: true });
  const reload = () => qc.invalidateQueries({ queryKey: ["crm-ownership-changes"] });

  return (
    <CrmShell title="Ownership Changes" subtitle="A new owner after the sale deed is registered, recorded from their own registered sale deed">
      <Breadcrumbs items={["CRM", "Resale", "Ownership Changes"]} />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Property, owner, deed no…"
                className="w-full h-9 pl-8 pr-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={reload} />
          </div>
          {rights.canCreate && (
            <button onClick={() => setCreating(true)} className="w-full h-9 text-sm rounded-lg bg-primary text-primary-foreground inline-flex items-center justify-center gap-1.5"><Plus size={14} />Record a new owner</button>
          )}
          {isLoading ? <p className="text-xs text-muted-foreground p-3">Loading…</p>
            : !list.length ? <p className="text-xs text-muted-foreground p-3 rounded-lg border border-dashed border-border">No ownership changes yet.</p>
            : (
              <ul className="space-y-2">
                {list.map((d) => {
                  const s = STATUS[d.Status] || [d.Status, ""];
                  return (
                    <li key={d.Id}>
                      <button onClick={() => pick(d.Id)} className={`w-full text-left rounded-xl border p-3 transition-colors ${selected === d.Id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/40"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold truncate">{d.FromName}<span className="font-normal opacity-60"> → {d.ToName}</span></span>
                          <span className={`text-[0.625rem] px-1.5 py-0.5 rounded-full border font-medium shrink-0 ${s[1]}`}>{s[0]}</span>
                        </div>
                        <div className="text-[0.6875rem] font-mono text-muted-foreground mt-1">{d.ChangeNo} · {d.Property}</div>
                        <div className="text-[0.6875rem] text-muted-foreground mt-0.5">{d.DeedNo ? `Sale deed ${d.DeedNo}` : "Sale deed details not in yet"}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
        </aside>
        <main className="min-w-0">
          {selected ? <Detail key={selected} id={selected} canEdit={rights.canEdit} onChanged={reload} />
            : <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Choose a record, or record a new owner.</div>}
        </main>
      </div>
      <NewDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); reload(); pick(id); }} />
    </CrmShell>
  );
};

export default CrmOwnershipChanges;
