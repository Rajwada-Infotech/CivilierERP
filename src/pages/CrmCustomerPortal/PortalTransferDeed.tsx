import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Eye, FileSignature, Upload } from "lucide-react";
import { API, authHeaders } from "./portalApi";
import { PageHeader, Card, CardHeader, INK, GOLD, GOLD_SOFT, HAIRLINE, SURFACE_ALT, TEXT, TEXT_MUTED, TEXT_FAINT } from "./portalTheme";

// Transfer Deed — when the customer's property is being resold (they are the
// seller), when they are buying one from another owner (the buyer), or when
// we are buying it back. They do their own part here: read the draft, approve
// it or ask for a correction, agree the signing date, send their papers and,
// when it is theirs to pay, the stamp-duty challan. Our team can also record
// any of these for them; whatever is recorded shows here.

const money = (n: any) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const when = (d: any) => (d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const day = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "—");
const btnPrimary = "inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-40";
const btnGhost = "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-40";
const field = "w-full h-10 px-3 text-sm rounded-lg border bg-transparent focus:outline-none";

async function send(path: string, method: string, body?: any) {
  const isForm = body instanceof FormData;
  const headers: Record<string, string> = authHeaders();
  if (isForm) delete headers["Content-Type"];
  const r = await fetch(`${API}${path}`, { method, headers, body: method === "GET" ? undefined : isForm ? body : JSON.stringify(body || {}) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || "Something went wrong");
  return out;
}

const DOC_STATE: Record<string, [string, string]> = {
  Requested: ["Please upload", "#b45309"], Uploaded: ["Received — being checked", "#2563eb"], Verified: ["Accepted", "#15803d"], Rejected: ["Please upload again", "#b91c1c"],
};

function DeedCard({ v, onChange }: { v: any; onChange: (next: any) => void }) {
  const d = v.deed;
  const [busy, setBusy] = useState<string | null>(null);
  const [recheck, setRecheck] = useState("");
  const [date, setDate] = useState("");
  const [pay, setPay] = useState({ PaidRef: "", AmountPaid: "", PaidOn: new Date().toISOString().slice(0, 10) });
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef<{ path: string; fields?: Record<string, string> } | null>(null);
  const other = v.role === "Seller" ? (d.BuyerName ? `buyer ${d.BuyerName}` : "us") : `seller ${d.SellerName}`;

  const act = async (key: string, path: string, method: string, body?: any, ok?: string) => {
    setBusy(key);
    try { onChange(await send(`/transfer-deeds/${d.Id}/${path}`, method, body)); toast.success(ok || "Done"); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };
  const pick = (path: string, fields?: Record<string, string>) => { target.current = { path, fields }; fileRef.current?.click(); };
  const onFile = (f: File) => {
    const t = target.current; if (!t) return;
    const fd = new FormData(); fd.append("file", f);
    for (const [k, val] of Object.entries(t.fields || {})) if (val) fd.append(k, val);
    act("file", t.path, "POST", fd, "Sent to our team").finally(() => { if (fileRef.current) fileRef.current.value = ""; });
  };
  const view = async (docId: number) => {
    const r = await fetch(`${API}/transfer-deeds/${d.Id}/documents/${docId}/file`, { headers: authHeaders() });
    if (!r.ok) { toast.error("Could not open it"); return; }
    const u = URL.createObjectURL(await r.blob()); window.open(u, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(u), 60_000);
  };
  const draft = v.documents.find((x: any) => x.DocumentType === "DeedDraft");
  const myDocs = v.documents.filter((x: any) => x.Party === v.role);
  const regCopy = v.documents.find((x: any) => x.DocumentType === "RegisteredDeed" && x.Status === "Verified");
  const step = v.steps.find((s: any) => s.state === "current");

  return (
    <Card>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <CardHeader icon={FileSignature} title={`${d.DeedType === "Assignment" ? "Deed of assignment" : "Cancellation deed"} · ${d.Property}`}
        action={<span className="text-[0.6875rem] font-semibold px-2.5 py-1 rounded-full" style={{ background: GOLD_SOFT, color: GOLD }}>You are the {v.role.toLowerCase()}</span>} />
      <div className="p-5 space-y-5">
        <p className="text-sm" style={{ color: TEXT_MUTED }}>
          {d.DeedType === "Assignment"
            ? `${d.SellerName}'s booking (${d.BookingNo}) passes to ${d.BuyerName} by a deed signed by both of you and us, registered at the Sub-Registrar.`
            : `We are buying back ${d.Property} from ${d.SellerName}; the agreement is cancelled by a registered deed.`}
          {" "}Reference {d.DeedNo}{d.VersionNo > 1 ? ` · version ${d.VersionNo}` : ""}.
        </p>

        {/* Progress */}
        <ol className="flex flex-wrap gap-x-4 gap-y-2">
          {v.steps.map((s: any, i: number) => (
            <li key={s.key} className="flex items-center gap-1.5 text-xs" style={{ color: s.ok ? "#15803d" : s.state === "current" ? TEXT : TEXT_FAINT }}>
              <span className="w-5 h-5 rounded-full grid place-items-center text-[0.625rem] font-bold" style={{ background: s.ok ? "#dcfce7" : s.state === "current" ? GOLD_SOFT : SURFACE_ALT, color: s.ok ? "#15803d" : s.state === "current" ? GOLD : TEXT_FAINT }}>
                {s.ok ? <Check size={11} /> : i + 1}
              </span>{s.label}
            </li>
          ))}
        </ol>
        {d.Status === "Registered" && <p className="text-sm font-medium" style={{ color: "#15803d" }}>Complete — the deed is registered{v.registry?.RegNo ? ` (${v.registry.RegNo})` : ""}.</p>}
        {step && d.Status !== "Registered" && <p className="text-xs" style={{ color: TEXT_MUTED }}>Now: {step.label}</p>}

        {/* My papers */}
        {myDocs.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Your papers</h3>
            {myDocs.map((x: any) => {
              const [word, color] = DOC_STATE[x.Status] || [x.Status, TEXT_MUTED];
              return (
                <div key={x.Id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5" style={{ border: `1px solid ${HAIRLINE}` }}>
                  <span className="text-sm flex-1" style={{ color: TEXT }}>{x.Label}{x.Remarks && x.Status === "Rejected" ? <span className="block text-xs" style={{ color: "#b91c1c" }}>{x.Remarks}</span> : null}</span>
                  <span className="text-xs font-medium" style={{ color }}>{word}</span>
                  {x.HasFile && <button className={btnGhost} style={{ borderColor: HAIRLINE, color: TEXT }} onClick={() => view(x.Id)}><Eye size={12} /> View</button>}
                  {["Requested", "Rejected"].includes(x.Status) && ["Draft", "UnderReview"].includes(d.Status) &&
                    <button className={btnGhost} style={{ borderColor: HAIRLINE, color: TEXT }} disabled={!!busy} onClick={() => pick(`documents/${x.Id}/upload`)}><Upload size={12} /> Upload</button>}
                </div>
              );
            })}
          </section>
        )}

        {/* The draft */}
        {d.Status === "WithParties" && (
          <section className="rounded-xl p-4 space-y-3" style={{ background: SURFACE_ALT }}>
            <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Please review the draft</h3>
            {draft?.HasFile && <button className={btnGhost} style={{ borderColor: HAIRLINE, color: TEXT }} onClick={() => view(draft.Id)}><Eye size={12} /> Read the draft</button>}
            {d.MyApproval === "Approved" ? <p className="text-sm" style={{ color: "#15803d" }}>You approved it. Waiting for the {other}.</p> : (
              <div className="space-y-2">
                <button className={btnPrimary} style={{ background: INK }} disabled={!!busy} onClick={() => act("ok", "respond", "PUT", { decision: "Approved" }, "Thank you — approved")}>I approve the draft</button>
                <div className="flex flex-wrap gap-2 items-end">
                  <textarea className={`${field} h-16 py-2 flex-1 min-w-[220px]`} style={{ borderColor: HAIRLINE, color: TEXT }} value={recheck} onChange={(e) => setRecheck(e.target.value)} placeholder="Something to correct? Tell us what…" />
                  <button className={btnGhost} style={{ borderColor: HAIRLINE, color: TEXT }} disabled={!recheck.trim() || !!busy} onClick={() => act("re", "respond", "PUT", { decision: "Recheck", remarks: recheck }, "Sent — our legal team will revise it")}>Ask for a correction</button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Signing date */}
        {d.Status === "PartiesApproved" && (
          <section className="rounded-xl p-4 space-y-3" style={{ background: SURFACE_ALT }}>
            <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Signing date</h3>
            {d.ProposedDate ? (
              <p className="text-sm" style={{ color: TEXT }}>Proposed: <b>{day(d.ProposedDate)}</b>{d.ProposedBy === v.role ? " (by you)" : ""}.{d.DateApprovalStatus === "Pending" ? " Everyone has accepted — awaiting final confirmation." : ""}</p>
            ) : <p className="text-sm" style={{ color: TEXT_MUTED }}>No date proposed yet — propose one that suits you.</p>}
            {d.ProposedDate && !d.MyDateAccepted && d.DateApprovalStatus !== "Pending" &&
              <button className={btnPrimary} style={{ background: INK }} disabled={!!busy} onClick={() => act("acc", "date/accept", "PUT", {}, "Date accepted")}>This date works for me</button>}
            {d.DateApprovalStatus !== "Pending" && (
              <div className="flex flex-wrap items-end gap-2">
                <input type="date" className={`${field} max-w-[200px]`} style={{ borderColor: HAIRLINE, color: TEXT }} min={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} />
                <button className={btnGhost} style={{ borderColor: HAIRLINE, color: TEXT }} disabled={!date || !!busy} onClick={() => act("prop", "date/propose", "PUT", { Date: date }, "Date proposed")}>{d.ProposedDate ? "Suggest another date" : "Propose this date"}</button>
              </div>
            )}
          </section>
        )}
        {d.DeedDate && <p className="text-sm" style={{ color: TEXT }}>Signing date: <b>{day(d.DeedDate)}</b>{d.ExecutedAt ? " — signed" : ""}</p>}

        {/* Stamp duty */}
        {v.payment && (
          <section className="rounded-xl p-4 space-y-2" style={{ background: SURFACE_ALT }}>
            <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Stamp duty & registration fee</h3>
            <p className="text-sm" style={{ color: TEXT }}>{money(v.payment.StampDuty)} stamp duty + {money(v.payment.RegistrationFee)} registration fee · paid by {v.payment.PayableBy === v.role ? "you" : v.payment.PayableBy === "Shared" ? "both parties" : v.payment.PayableBy === "Developer" ? "us" : `the ${v.payment.PayableBy.toLowerCase()}`}</p>
            {v.payment.Status === "Confirmed" && <p className="text-sm" style={{ color: "#15803d" }}>Payment confirmed.</p>}
            {v.payment.Status === "ProofUploaded" && <p className="text-sm" style={{ color: TEXT_MUTED }}>Challan {v.payment.PaidRef} received — being checked.</p>}
            {v.payment.IAmPayer && v.payment.Status === "InfoSent" && (
              <div className="space-y-2">
                {v.payment.ConfirmRemarks && <p className="text-xs" style={{ color: "#b91c1c" }}>{v.payment.ConfirmRemarks}</p>}
                <div className="grid sm:grid-cols-3 gap-2">
                  <input className={field} style={{ borderColor: HAIRLINE, color: TEXT }} placeholder="GRN / challan no." value={pay.PaidRef} onChange={(e) => setPay({ ...pay, PaidRef: e.target.value })} />
                  <input className={field} style={{ borderColor: HAIRLINE, color: TEXT }} type="number" min={0} placeholder="Amount paid" value={pay.AmountPaid} onChange={(e) => setPay({ ...pay, AmountPaid: e.target.value })} />
                  <input className={field} style={{ borderColor: HAIRLINE, color: TEXT }} type="date" value={pay.PaidOn} onChange={(e) => setPay({ ...pay, PaidOn: e.target.value })} />
                </div>
                <button className={btnPrimary} style={{ background: INK }} disabled={!pay.PaidRef.trim() || !(Number(pay.AmountPaid) > 0) || !!busy} onClick={() => pick("duty/proof", pay)}><Upload size={14} /> Upload the challan</button>
              </div>
            )}
          </section>
        )}

        {v.registry && (
          <p className="text-sm" style={{ color: TEXT }}>Sub-Registrar visit: <b>{v.registry.Office}</b>, {when(v.registry.ScheduledAt)}{v.registry.Attendees ? ` · ${v.registry.Attendees}` : ""}</p>
        )}
        {regCopy && <button className={btnGhost} style={{ borderColor: HAIRLINE, color: TEXT }} onClick={() => view(regCopy.Id)}><Eye size={12} /> Registered deed</button>}
      </div>
    </Card>
  );
}

const PortalTransferDeed: React.FC = () => {
  const qc = useQueryClient();
  const q = useQuery<any[]>({ queryKey: ["portal-transfer-deeds"], queryFn: () => send("/transfer-deeds", "GET") as any });
  const replace = (next: any) => qc.setQueryData<any[]>(["portal-transfer-deeds"], (old) => (old || []).map((x) => (x.deed.Id === next.deed.Id ? next : x)));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Legal" title="Transfer Deed" subtitle="When a property passes to a new owner — or back to us — the deed is reviewed, dated, stamped and registered here." />
      {q.isLoading ? <p className="text-sm" style={{ color: TEXT_MUTED }}>Loading…</p>
        : q.isError ? <p className="text-sm" style={{ color: "#b91c1c" }}>{(q.error as any)?.message}</p>
        : !(q.data || []).length ? <Card><p className="p-6 text-sm" style={{ color: TEXT_MUTED }}>Nothing here — this is where a resale or buy-back deed appears when you are part of one.</p></Card>
        : (q.data || []).map((v) => <DeedCard key={v.deed.Id} v={v} onChange={replace} />)}
    </div>
  );
};

export default PortalTransferDeed;
