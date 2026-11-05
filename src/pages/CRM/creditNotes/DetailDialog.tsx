// One credit note opened: its PDF, amounts and tax split, where it comes from, its history — and, while raised,
// editing and approval; once issued, cancelling (through its own approval) and re-issuing.
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban, Download, ExternalLink, Printer, RotateCcw, Send, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { INP, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } from "../customers/config";
import { API, DIALOG, KIND, NoteMark, REASON_LABEL, REQ_LABEL, day, formatSac, getJson, inr, kindOf } from "./config";

function PdfPreview({ id, version }: { id: number; version: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    setUrl(null);
    setFailed(false);
    fetchWithAuth(`${API}/gst-notes/${id}/pdf`)
      .then(async (r) => {
        if (!r.ok) throw new Error();
        u = URL.createObjectURL(await r.blob());
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [id, version]);
  if (failed) return <p className="p-6 text-sm text-destructive">Couldn't load the PDF — refresh and try again.</p>;
  if (!url) return <p className="p-6 text-sm text-muted-foreground">Preparing the PDF…</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-2 justify-end">
        <a href={url} download className={`${KEY_LINE} h-8 px-3`}><Download size={12} /> Download</a>
        <button onClick={() => { const w = window.open(url, "_blank"); w?.addEventListener("load", () => w.print()); }} className={`${KEY_LINE} h-8 px-3`}>
          <Printer size={12} /> Print
        </button>
      </div>
      <iframe title="Credit note PDF" src={url} className="w-full h-[65vh] min-h-[480px] bg-white" style={{ border: RULE_SOFT }} />
    </div>
  );
}

/** A raised credit note before it is issued: edit, send for approval, approve / send back. */
function RequestPanel({ n, canEdit, refresh }: { n: any; canEdit: boolean; refresh: () => void }) {
  const [amount, setAmount] = useState(String(n.TotalAmount ?? ""));
  const [reasonType, setReasonType] = useState(n.ReasonType || "Discount");
  const [remarks, setRemarks] = useState(n.Remarks || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const editable = canEdit && ["Draft", "Rejected"].includes(n.Status);
  const dirty = Number(amount) !== Number(n.TotalAmount) || reasonType !== n.ReasonType || remarks !== (n.Remarks || "");
  const run = async (key: string, url: string, body: any, ok: string) => {
    setBusy(key);
    try {
      await getJson(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
      toast.success(ok);
      setNote("");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="p-4 space-y-3 text-sm" style={{ border: RULE_SOFT, borderLeft: "3px solid hsl(var(--foreground))" }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading font-semibold">{REQ_LABEL[n.Status]}</h3>
        <span className="text-xs text-muted-foreground">Raised {day(n.RequestedAt || n.CreatedAt)}{n.CreatedBy ? ` by ${n.CreatedBy}` : ""}</span>
      </div>
      {n.Status === "Rejected" && n.RejectionNote && <p className="text-xs text-destructive">Sent back: {n.RejectionNote}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={`block mb-1 ${LBL}`}>Amount (incl. GST)</label>
          <input type="number" disabled={!editable} value={amount} onChange={(e) => setAmount(e.target.value)} className={`${INP} tabular-nums disabled:opacity-70`} />
        </div>
        <div>
          <label className={`block mb-1 ${LBL}`}>Why</label>
          <select disabled={!editable} value={reasonType} onChange={(e) => setReasonType(e.target.value)} className={`${INP} disabled:opacity-70`}>
            {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <div className={`mb-1 ${LBL}`}>Declare by</div>
          <div className="h-9 flex items-center text-sm tabular-nums">{day(n.DeadlineDate)}</div>
        </div>
      </div>
      <div>
        <label className={`block mb-1 ${LBL}`}>What changed</label>
        <textarea disabled={!editable} value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={`${TEXTAREA} disabled:opacity-70`} />
      </div>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <button disabled={!dirty || !!busy} onClick={() => run("save", `${API}/gst-notes/${n.Id}`, { Amount: Number(amount), ReasonType: reasonType, Remarks: remarks }, "Saved")}
            className={`${KEY_LINE} h-8 px-3`}>Save</button>
          <button disabled={dirty || !!busy} title={dirty ? "Save your changes first" : undefined}
            onClick={() => run("submit", `${API}/gst-notes/${n.Id}/submit`, null, "Sent for approval")} className={`${KEY_INK} h-8 px-3`}>
            <Send size={12} /> {n.Status === "Rejected" ? "Send again" : "Send for approval"}
          </button>
        </div>
      )}
      {canEdit && n.Status === "Pending" && (
        <div className="space-y-2 pt-3" style={{ borderTop: RULE_SOFT }}>
          <p className="text-xs text-muted-foreground">Approvers: approve here or in the Approval Inbox.</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Remarks (needed to send back)" className={TEXTAREA} />
          <div className="flex gap-2">
            <button disabled={!!busy} onClick={() => run("approve", `${API}/gst-notes/${n.Id}/approve`, { note }, "Approved — credit note issued")} className={`${KEY_INK} h-8 px-3`}>
              <ShieldCheck size={12} /> Approve
            </button>
            <button disabled={!!busy || !note.trim()} onClick={() => run("reject", `${API}/gst-notes/${n.Id}/reject`, { note }, "Sent back")} className={`${KEY_LINE} h-8 px-3`}>Send back</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card text-xs" style={{ border: RULE_SOFT }}>
      <div className={`px-3 py-2 ${LBL}`} style={{ borderBottom: RULE_SOFT }}>{title}</div>
      <div className="p-3 space-y-1.5">{children}</div>
    </div>
  );
}
const Line = ({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) => (
  <div className={`flex justify-between gap-2 ${strong ? "font-semibold pt-1.5" : ""}`} style={strong ? { borderTop: RULE_SOFT } : undefined}>
    <span className={strong ? "" : "text-muted-foreground"}>{k}</span>
    <span className="text-right tabular-nums">{v}</span>
  </div>
);

export function DetailDialog({ id, canEdit, onClose, onChanged, onOpen }: {
  id: number; canEdit: boolean; onClose: () => void; onChanged: () => void; onOpen: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { data: n, isLoading, isError, error } = useQuery<any>({
    queryKey: ["crm-credit-note", id],
    queryFn: () => getJson(`${API}/gst-notes/${id}`),
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading || isError || !n)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className={`max-w-md ${DIALOG} text-center text-sm ${isError || (!isLoading && !n) ? "text-destructive" : "text-muted-foreground"}`} style={{ border: RULE }}>
          <DialogTitle className="sr-only">Credit note</DialogTitle>
          {isLoading ? "Loading the credit note…" : (error as any)?.message || "Credit note not found"}
        </DialogContent>
      </Dialog>
    );

  const k = kindOf(n);
  const half = Math.round((Number(n.GstAmount) / 2) * 100) / 100;
  const sameState = n.IntraState !== false; // worked out on the server (project / company GSTIN state codes)

  const refresh = () => { qc.invalidateQueries({ queryKey: ["crm-credit-note"] }); onChanged(); };
  const act = async (fn: () => Promise<any>, ok: string, after?: () => void) => {
    setBusy(true);
    try { await fn(); toast.success(ok); after?.(); refresh(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const put = (url: string, body: object) => getJson(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const doCancel = () => act(() => put(`${API}/gst-notes/${id}/cancel`, { reason }), "Cancellation sent for approval", () => { setCancelOpen(false); setReason(""); });
  const decideCancel = (approve: boolean) => act(() => put(`${API}/gst-notes/cancel-requests/${id}/${approve ? "approve" : "reject"}`, { note: reason }),
    approve ? "Cancellation approved" : "Cancellation turned down", () => setReason(""));
  const doReissue = () => act(() => getJson(`${API}/${n.RefundId}/gst-notes/reissue`, { method: "POST" }), "Re-issued");

  const banner =
    k === "invoice" ? (
      <>Reduces invoice <b>{n.AgainstRef}</b>. Declare it in GSTR-1 by <b>{day(n.DeadlineDate)}</b> (or the annual return); the GST below comes off what we owe.</>
    ) : k === "advance" ? (
      <>The money came in as an advance with GST and was never invoiced, so it is given back on a refund voucher. Its GST comes off the advances we paid tax on.</>
    ) : k === "barred" ? (
      <>Invoice <b>{n.AgainstRef}</b> is past its declare-by date ({day(n.DeadlineDate)}), so no credit note can be issued. Give the buyer this GST-paid certificate — they claim the GST from the department (Circular 188/20/2022).</>
    ) : k === "request" ? (
      <>A credit note on invoice <b>{n.AgainstRef}</b> for {REASON_LABEL[n.ReasonType] || "a reduction"}: {n.Remarks}</>
    ) : (
      <>Cancelled {day(n.CancelledAt)}{n.CancelledBy ? ` by ${n.CancelledBy}` : ""} — {n.CancelReason}. Its number stays in the series.{n.ReplacedByNo ? <> Replaced by <b>{n.ReplacedByNo}</b>.</> : null}</>
    );
  const allCancelled = k === "cancelled" && !(n.siblings || []).some((s: any) => s.Status !== "Cancelled");
  const linkKey = `${KEY_LINE} h-8 px-3`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-6xl max-h-[92vh] overflow-y-auto ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4 pr-6">
            <span className="font-heading tabular-nums">{n.DocNo || (k === "request" ? "Not issued yet" : "Certificate")}</span>
            <span className={`${LBL} !text-foreground`}>{KIND[k].label}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">Credit note details</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4 bg-card" style={{ border: RULE_SOFT }}>
            <div>
              <div className="text-sm font-semibold">
                {n.CustomerName}
                {n.CustomerGst ? <span className="ml-2 font-heading text-[0.6875rem] font-normal px-1.5 py-0.5 tabular-nums" style={{ border: RULE_SOFT }}>GSTIN {n.CustomerGst}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{n.Property} · {n.ProjectName || ""} · Booking <span className="font-heading tabular-nums">{n.BookingNo}</span></div>
              <div className="mt-2"><NoteMark n={n} /></div>
            </div>
            <div className="text-right">
              <div className="font-heading text-2xl font-bold tabular-nums">{inr(n.TotalAmount)}</div>
              <div className="text-xs text-muted-foreground tabular-nums">GST {inr(n.GstAmount)}{n.GstRate != null ? ` @ ${Number(n.GstRate)}%` : ""} · {day(n.DocDate)}</div>
            </div>
          </div>

          <p className={`text-xs px-3 py-2.5 ${k === "cancelled" ? "text-destructive" : ""}`}
            style={{ border: RULE_SOFT, borderLeft: `3px solid ${k === "cancelled" ? "hsl(var(--destructive))" : "hsl(var(--foreground))"}` }}>
            {banner}
          </p>

          <div className="flex flex-wrap gap-2">
            {canEdit && ["invoice", "advance", "barred"].includes(k) && n.CancelApprovalStatus !== "Pending" && (
              <button onClick={() => setCancelOpen(true)} className={`${linkKey} !text-destructive !border-destructive`}><Ban size={12} /> Cancel…</button>
            )}
            {canEdit && allCancelled && !n.ReplacedByNo && (
              <button onClick={doReissue} disabled={busy} className={`${KEY_INK} h-8 px-3`}><RotateCcw size={12} /> Re-issue</button>
            )}
            {n.RefundNo && <Link to={`/crm/refunds?search=${encodeURIComponent(n.RefundNo)}`} className={linkKey}>Refund {n.RefundNo} <ExternalLink size={11} /></Link>}
            <Link to={`/crm/bookings?view=${n.BookingId}`} className={linkKey}>Booking {n.BookingNo} <ExternalLink size={11} /></Link>
            {n.InvoiceId && <Link to={`/crm/invoices?invoiceId=${n.InvoiceId}`} className={linkKey}>Invoice {n.AgainstRef} <ExternalLink size={11} /></Link>}
          </div>

          {n.CancelApprovalStatus === "Pending" && (
            <div className="p-3 text-sm space-y-2" style={{ border: "1px solid hsl(var(--destructive) / 0.4)", borderLeft: "3px solid hsl(var(--destructive))" }}>
              <div><b>Cancellation requested</b> {day(n.CancelRequestedAt)} — {n.CancelRequestReason}. Waiting for approval.</div>
              {canEdit && (
                <>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Remarks (needed to keep it)" className={TEXTAREA} />
                  <div className="flex gap-2">
                    <button onClick={() => decideCancel(true)} disabled={busy} className={`${KEY_RED} h-8 px-3`}>Approve cancellation</button>
                    <button onClick={() => decideCancel(false)} disabled={busy || !reason.trim()} className={`${KEY_LINE} h-8 px-3`}>Keep it</button>
                  </div>
                </>
              )}
            </div>
          )}

          {k === "request" && <RequestPanel n={n} canEdit={canEdit} refresh={refresh} />}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="p-4 bg-card" style={{ border: RULE_SOFT }}>
              <PdfPreview id={id} version={`${n.Status}${n.CancelledAt || ""}`} />
            </div>
            <aside className="space-y-4">
              <Box title="Amounts">
                <Line k="Taxable value" v={inr(n.TaxableValue)} />
                {sameState ? (
                  <>
                    <Line k="CGST" v={inr(half)} />
                    <Line k="SGST" v={inr(Number(n.GstAmount) - half)} />
                  </>
                ) : (
                  <Line k="IGST" v={inr(n.GstAmount)} />
                )}
                <Line k="Total" v={inr(n.TotalAmount)} strong />
                <div className="text-[0.6875rem] text-muted-foreground pt-1">
                  Place of supply: {n.PlaceOfSupply ? `${n.PlaceOfSupply}${n.PlaceOfSupplyCode ? ` (${n.PlaceOfSupplyCode})` : ""}` : "where the property is"} · HSN/SAC {formatSac(n.HsnCode)}
                </div>
              </Box>

              <Box title="Where it comes from">
                <Line k="Against" v={<>{n.AgainstRef || "—"}{n.AgainstDate ? ` · ${day(n.AgainstDate)}` : ""}</>} />
                {n.RefundNo ? (
                  <>
                    <Line k="Refund" v={`${n.RefundNo} · paid ${day(n.RefundPaidAt)}`} />
                    <Line k="Refund paid" v={inr(n.RefundNet)} />
                  </>
                ) : (
                  <>
                    <Line k="Why" v={REASON_LABEL[n.ReasonType] || "—"} />
                    {Number(n.MovedToAccount) > 0 && <Line k="Moved to account" v={inr(n.MovedToAccount)} />}
                  </>
                )}
                {Number(n.RefundKept) > 0 && <Line k="Kept as charges" v={`${inr(n.RefundKept)} (no credit note)`} />}
                {n.RefundReason && <div className="text-muted-foreground pt-1 italic">“{n.RefundReason}”</div>}
              </Box>

              {(n.siblings || []).length > 0 && (
                <Box title="Same refund's documents">
                  {n.siblings.map((x: any) => (
                    <button key={x.Id} onClick={() => onOpen(x.Id)} className="w-full flex justify-between gap-2 hover:underline text-left">
                      <span>{KIND[kindOf(x)].short} <span className="font-heading tabular-nums text-muted-foreground">{x.DocNo}</span></span>
                      <span className="font-heading tabular-nums">{inr(x.TotalAmount)}</span>
                    </button>
                  ))}
                </Box>
              )}

              <Box title="History">
                <div>{n.Source === "Adjustment" ? "Raised" : "Issued"} {day(n.CreatedAt)}{n.CreatedBy ? ` by ${n.CreatedBy}` : ""}{n.ReplacesNo ? ` — replaces ${n.ReplacesNo}` : ""}</div>
                {n.ApprovedAt && <div>Approved and issued {day(n.ApprovedAt)}</div>}
                {n.CancelRequestedAt && <div>Cancellation requested {day(n.CancelRequestedAt)} — {n.CancelRequestReason}</div>}
                {n.CancelledAt && <div className="text-destructive">Cancelled {day(n.CancelledAt)}{n.CancelledBy ? ` by ${n.CancelledBy}` : ""} — {n.CancelReason}</div>}
                {n.ReplacedByNo && <div>Replaced by {n.ReplacedByNo}</div>}
              </Box>
            </aside>
          </div>
        </div>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">Ask to cancel {n.DocNo || "this certificate"}</DialogTitle>
              <DialogDescription className="text-xs">
                {n.RefundNo
                  ? `Every credit note of refund ${n.RefundNo} is cancelled together; you can re-issue afterwards.`
                  : "The booking value, milestone, and customer's account go back as they were."} The cancellation goes for approval.
              </DialogDescription>
            </DialogHeader>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why is it being cancelled?" className={TEXTAREA} />
            <DialogFooter className="gap-2">
              <button onClick={() => setCancelOpen(false)} className={`${KEY_LINE} h-9 px-4`}>Keep it</button>
              <button onClick={doCancel} disabled={busy || !reason.trim()} className={`${KEY_RED} h-9 px-4`}>{busy ? "Sending…" : "Ask to cancel"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
