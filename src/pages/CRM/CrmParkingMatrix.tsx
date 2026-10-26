// CRM Parking Matrix: every parking slot of a project by block and type, with who holds or has bought it. A free slot
// can be sold on its own (no unit booking needed) or held for a customer; a held or sold one opens to show the record.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Car } from "lucide-react";
import { getSocket } from "@/lib/socket";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ExtendRow, Facts, Field, HOLDS_API, INP, KEY_INK, KEY_LINE, KEY_RED, LBL, Legend, PlaceHoldDialog, RULE, RULE_SOFT, Section, TILE_GRID, Tile,
  customerOptions, fetchOptions, fmtMoney, holdCall, holdLeft, useMatrixCustomers, type Option, type TileStatus,
} from "./matrix/shared";

const API = "/api/parking-matrix";
const RATE_API = "/api/parking-master/rate";

interface MatrixSlot {
  Id: number;
  SlotNo: string;
  ParkingType: string;
  BlockId: number | null;
  BlockName: string | null;
  Status: TileStatus;
  AllotmentId: number | null;
  BookingId: number | null;
  BookingNo: string | null;
  AllotmentDate: string | null;
  TotalAmount: number | null;
  AllotmentPaymentStatus: string | null;
  Quantity: number | null;
  ApplicationId: number | null;
  ApplicationNo: string | null;
  ApplicantName: string | null;
  Mobile: string | null;
  AssignedToName: string | null;
  AssignedToEmail: string | null;
  HoldId: number | null;
  HoldUntil: string | null;
  HoldApplicationId: number | null;
  HoldApplicationNo: string | null;
  HoldApplicantName: string | null;
  HoldMobile: string | null;
  HoldAssignedToName: string | null;
  HoldAssignedToEmail: string | null;
}

async function fetchMatrix(projectId: string, blockId: string): Promise<MatrixSlot[]> {
  const params = new URLSearchParams({ projectId });
  if (blockId) params.set("blockId", blockId);
  return fetchOptions<MatrixSlot>(`${API}?${params}`);
}

// Sell a slot on its own: who it's for (any live customer of the project, booked or not) and how many. A customer
// with a unit booking can instead get parking from the booking's Charges, so it rides the booking's schedule; this
// path is always a standalone, separately paid sale.
function SellDialog({ slot, projectId, onClose }: { slot: MatrixSlot; projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [applicationId, setApplicationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: customers = [], isLoading } = useMatrixCustomers(projectId);
  const { data: rate, isLoading: loadingRate } = useQuery({
    queryKey: ["parking-rate", projectId, slot.BlockId, slot.ParkingType],
    queryFn: async () => {
      const params = new URLSearchParams({ projectId, parkingType: slot.ParkingType });
      if (slot.BlockId) params.set("blockId", String(slot.BlockId));
      const r = await fetchWithAuth(`${RATE_API}?${params}`);
      return r.ok ? r.json() : null;
    },
  });

  const sell = async () => {
    if (!applicationId) return void toast.error("Select a customer.");
    if (!rate?.Id) return void toast.error(`No ${slot.ParkingType} parking rate is set for this project or block.`);
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/crm/parking/standalone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ApplicationId: parseInt(applicationId, 10), ParkingMasterId: rate.Id, ParkingSlotId: slot.Id, Quantity: parseInt(quantity, 10) || 1, Notes: notes || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not sell the slot.");
      toast.success(`Slot ${slot.SlotNo} sold for ${fmtMoney(data.TotalAmount)}`);
      qc.invalidateQueries({ queryKey: ["parking-matrix"] });
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em]">Sell slot {slot.SlotNo}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-px" style={{ background: "hsl(var(--foreground) / 0.15)", border: RULE_SOFT }}>
          <div className="bg-card px-3 py-2"><p className={LBL}>Type</p><p className="text-sm font-medium mt-0.5">{slot.ParkingType}</p></div>
          <div className="bg-card px-3 py-2"><p className={LBL}>Rate</p>
            <p className={`text-sm font-medium mt-0.5 tabular-nums ${!loadingRate && !rate ? "text-destructive" : ""}`}>{loadingRate ? "…" : rate ? `${fmtMoney(rate.Charge)} + ${rate.GstRate}% GST` : "No rate set"}</p>
          </div>
        </div>
        <Field label="Customer *" hint="Any live customer of this project, with or without a unit booking.">
          <SearchableSelect value={applicationId} onChange={setApplicationId} placeholder={isLoading ? "Loading customers…" : customers.length ? "Select customer" : "No live customer in this project"}
            searchPlaceholder="Search name, mobile or application…" options={customerOptions(customers)} />
        </Field>
        <Field label="Quantity"><input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={INP} /></Field>
        <Field label="Notes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${INP} h-auto py-2 resize-none`} /></Field>
        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={sell} disabled={saving || !rate} className={`${KEY_INK} h-9 px-4`}>{saving ? "Selling…" : "Sell slot"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// A held or sold slot, opened. A sale can be standalone (no booking). "Held" also covers a sale whose own charge isn't
// paid yet: Extend is offered there, while releasing the sale itself belongs to the booking's Charges (it follows the
// same legal-work and amendment rules as any other post-booking change), so this links out.
function TileInfoDialog({ slot, onClose }: { slot: MatrixSlot; onClose: () => void }) {
  const rights = usePageRights("crm-parking-matrix");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const isHold = slot.Status === "OnHold";
  const hasUnpaidAllotment = isHold && slot.AllotmentId != null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["parking-matrix"] });

  const release = async () => {
    setBusy(true);
    try {
      await holdCall(`${HOLDS_API}/${slot.HoldId}/release`, "PUT");
      toast.success(`Hold released; slot ${slot.SlotNo} is free again`);
      refresh();
      onClose();
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setBusy(false); }
  };

  const pick = <T,>(hold: T, own: T) => (isHold && hold) || own;
  const left = isHold ? holdLeft(slot.HoldUntil) : null;
  const state = isHold ? (hasUnpaidAllotment ? "Sold, payment pending" : "On hold") : "Sold";
  // The booking's own card when there is one; a standalone sale has only its application.
  const openRecord = () => navigate(slot.BookingId != null ? `/crm/bookings?view=${slot.BookingId}` : `/crm/applications?id=${slot.ApplicationId}`);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="min-w-0">
            <span className={`block ${LBL}`}>Parking slot</span>
            <span className="font-heading text-lg font-bold flex flex-wrap items-center gap-2">
              <Car size={16} /> <span className="tabular-nums">{slot.SlotNo}</span>
              <SheetMark text={state} tone={isHold ? "waiting" : "done"} />
            </span>
            <span className="block text-xs text-muted-foreground font-normal mt-0.5">{[slot.ParkingType, slot.BlockName, slot.Quantity ? `Qty ${slot.Quantity}` : null].filter(Boolean).join(" · ")}</span>
          </DialogTitle>
        </DialogHeader>

        <Facts title="Customer" rows={[
          ["Application", pick(slot.HoldApplicationNo, slot.ApplicationNo)],
          ["Applicant", pick(slot.HoldApplicantName, slot.ApplicantName)],
          ["Mobile", pick(slot.HoldMobile, slot.Mobile)],
          ["Salesperson", <>{pick(slot.HoldAssignedToName, slot.AssignedToName) || "—"}{pick(slot.HoldAssignedToEmail, slot.AssignedToEmail) && <span className="block text-[0.6875rem] text-muted-foreground">{pick(slot.HoldAssignedToEmail, slot.AssignedToEmail)}</span>}</>],
        ]} />

        {slot.AllotmentId != null && (
          <Facts title="Sale" rows={[
            ["Booking", slot.BookingNo || "Standalone parking sale"],
            ["Payment", slot.AllotmentPaymentStatus ? <SheetMark text={slot.AllotmentPaymentStatus} tone={slot.AllotmentPaymentStatus === "Paid" ? "done" : "waiting"} /> : "—"],
            ["Sold on", slot.AllotmentDate ? String(slot.AllotmentDate).slice(0, 10) : "—"],
            ["Charge", fmtMoney(slot.TotalAmount)],
          ]} />
        )}

        {isHold && (
          <p className="text-xs px-3 py-2" style={{ border: RULE_SOFT }}>
            {hasUnpaidAllotment ? "The parking charge isn't paid yet; the tile turns Sold once it is." : "Held for the customer while they decide."}
            {left && <span className="font-semibold"> Hold: {left}.</span>}
          </p>
        )}

        {showExtend && slot.HoldId != null && <ExtendRow holdId={slot.HoldId} onDone={() => { refresh(); onClose(); }} />}

        <div className="flex flex-wrap justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Close</button>
          {isHold && rights.canEdit && slot.HoldId != null && hasUnpaidAllotment && (
            <button onClick={() => setShowExtend((s) => !s)} className={`${KEY_LINE} h-9 px-3`}>Extend hold</button>
          )}
          {isHold && !hasUnpaidAllotment ? (
            rights.canEdit && slot.HoldId != null && (
              <button onClick={release} disabled={busy} className={`${KEY_RED} h-9 px-4`}>{busy ? "Releasing…" : "Release hold"}</button>
            )
          ) : (
            <button onClick={openRecord} className={`${KEY_INK} h-9 px-4`}>{slot.BookingId != null ? "Open booking" : "Open application"}</button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ParkingMatrixPage() {
  const navigate = useNavigate();
  const rights = usePageRights("crm-parking-matrix");
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [choiceSlot, setChoiceSlot] = useState<MatrixSlot | null>(null);
  const [sellSlot, setSellSlot] = useState<MatrixSlot | null>(null);
  const [holdSlot, setHoldSlot] = useState<MatrixSlot | null>(null);
  const [infoSlot, setInfoSlot] = useState<MatrixSlot | null>(null);

  // Live updates: any sale, hold or release on this project refreshes the matrix (whatever block is in view).
  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const onUpdate = (payload: any) => {
      if (!payload?.projectId || payload.projectId === Number(projectId)) qc.invalidateQueries({ queryKey: ["parking-matrix"] });
    };
    sock.on("matrix:update", onUpdate);
    return () => { sock.off("matrix:update", onUpdate); };
  }, [projectId, qc]);
  // Re-render every minute so the hold countdowns tick.
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  const { data: projects = [], isLoading: loadingProjects } = useQuery({ queryKey: ["parking-matrix-projects"], queryFn: () => fetchOptions<Option>(`${API}/projects`) });
  useEffect(() => { if (!projectId && projects.length === 1) setProjectId(String(projects[0].Id)); }, [projects, projectId]);
  const { data: blocks = [] } = useQuery({
    queryKey: ["parking-matrix-blocks", projectId],
    queryFn: () => fetchOptions<Option>(`${API}/blocks?projectId=${projectId}`),
    enabled: !!projectId,
  });
  const { data: slots = [], isLoading, isError, error } = useQuery({
    queryKey: ["parking-matrix", projectId, blockId],
    queryFn: () => fetchMatrix(projectId, blockId),
    enabled: !!projectId,
  });

  // By block, then by parking type (it was one flat grid of every slot).
  const grouped = useMemo(() => {
    const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
    const byBlock = new Map<string, Map<string, MatrixSlot[]>>();
    for (const s of slots) {
      const bk = s.BlockName || "No block";
      const tk = s.ParkingType || "Parking";
      if (!byBlock.has(bk)) byBlock.set(bk, new Map());
      const m = byBlock.get(bk)!;
      if (!m.has(tk)) m.set(tk, []);
      m.get(tk)!.push(s);
    }
    return Array.from(byBlock.entries()).sort(([a], [b]) => cmp(a, b)).map(([blockName, typeMap]) => ({
      blockName,
      count: Array.from(typeMap.values()).reduce((n, l) => n + l.length, 0),
      free: Array.from(typeMap.values()).reduce((n, l) => n + l.filter((s) => s.Status === "Available").length, 0),
      types: Array.from(typeMap.entries()).sort(([a], [b]) => cmp(a, b)).map(([t, list]) => [t, [...list].sort((x, y) => cmp(x.SlotNo, y.SlotNo))] as const),
    }));
  }, [slots]);

  const counts = useMemo(() => {
    const c: Record<TileStatus, number> = { Available: 0, OnHold: 0, Booked: 0, Blocked: 0 };
    slots.forEach((s) => { c[s.Status] = (c[s.Status] || 0) + 1; });
    return c;
  }, [slots]);
  const forSale = slots.length - counts.Blocked;
  const unpaid = slots.filter((s) => s.Status === "OnHold" && s.AllotmentId != null).length;
  const canSell = rights.canEdit;
  const canHold = rights.canCreate;

  const onTile = (s: MatrixSlot) => {
    if (s.Status === "OnHold" || s.Status === "Booked") return setInfoSlot(s);
    if (s.Status !== "Available") return;
    if (canSell && canHold) setChoiceSlot(s);
    else if (canSell) setSellSlot(s);
    else if (canHold) setHoldSlot(s);
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "CRM", path: "/crm/dashboard" }, { label: "Parking Matrix", path: "/crm/parking-matrix" }]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Parking Matrix"
        subtitle="Every parking slot of a project, by block and type. Sell a free slot on its own or hold it for a customer; open a held or sold one to see who."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => navigate("/crm/setup/parking-master")} className={`${KEY_LINE} h-9 px-3`}><Car size={13} /> Parking rates</button>
            <button onClick={() => navigate("/crm/setup/parking-slot-master")} className={`${KEY_LINE} h-9 px-3`}><Car size={13} /> Parking slots</button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card px-5 py-4 flex flex-wrap items-end gap-3" style={{ border: RULE }}>
            <label className="block space-y-1 w-full sm:w-72">
              <span className={`block ${LBL}`}>Project</span>
              <SearchableSelect value={projectId} onChange={(v) => { setProjectId(v); setBlockId(""); }}
                placeholder={loadingProjects ? "Loading…" : projects.length ? "Select project" : "No project you can see"}
                searchPlaceholder="Search projects…" options={projects.map((p) => ({ value: String(p.Id), label: p.Name }))} />
            </label>
            <label className="block space-y-1 w-full sm:w-56">
              <span className={`block ${LBL}`}>Block</span>
              <SearchableSelect value={blockId} onChange={setBlockId} disabled={!projectId} placeholder="All blocks"
                searchPlaceholder="Search blocks…" options={[{ value: "", label: "All blocks" }, ...blocks.map((b) => ({ value: String(b.Id), label: b.Name }))]} />
            </label>
            {projectId && slots.length > 0 && <div className="sm:ml-auto"><Legend counts={counts} bookedLabel="Sold" /></div>}
          </div>

          {!projectId ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Select a project to see its parking.</p>
          ) : isError ? (
            <p className="py-16 text-center text-sm text-destructive">{(error as Error)?.message}</p>
          ) : (
            <>
              <div className="bg-card" style={{ border: RULE }}>
                <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                  {[
                    { label: "Free", value: counts.Available, note: `of ${slots.length} slots in this view` },
                    { label: "On hold", value: counts.OnHold, note: unpaid ? `${unpaid} sold, charge not paid yet` : "Held for customers" },
                    { label: "Sold", value: counts.Booked, note: `${forSale ? Math.round((counts.Booked / forSale) * 100) : 0}% of what is for sale` },
                    { label: "Blocked", value: counts.Blocked, note: "Not for sale" },
                  ].map((x) => (
                    <div key={x.label}>
                      <p className="label">{x.label}</p>
                      <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                      <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {isLoading ? (
                <p className="py-16 text-center text-sm text-muted-foreground">Loading the matrix…</p>
              ) : slots.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">No parking slots in this selection. Add them in Parking slots.</p>
              ) : (
                grouped.map(({ blockName, count, free, types }) => (
                  <Section key={blockName} title={blockName} note={`${count} · ${free} free`}>
                    {types.map(([type, list]) => (
                      <div key={type}>
                        <p className={`mb-2 ${LBL}`}>{type}</p>
                        <div className={TILE_GRID}>
                          {list.map((s) => (
                            <Tile key={s.Id} name={s.SlotNo} status={s.Status}
                              line={s.Status === "Booked" ? (s.ApplicantName || s.BookingNo || "—") : s.Status === "OnHold" ? (s.HoldApplicantName || s.ApplicantName || "—") : s.Status === "Blocked" ? "Not for sale" : "Free"}
                              holdUntil={s.HoldUntil}
                              title={s.Status === "Available" && !canSell && !canHold ? "You don't have the right to sell or hold slots." : undefined}
                              disabled={s.Status === "Blocked" || (s.Status === "Available" && !canSell && !canHold)}
                              onClick={() => onTile(s)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </Section>
                ))
              )}
            </>
          )}
        </div>
      </SheetShell>

      {choiceSlot && (
        <Dialog open onOpenChange={(o) => !o && setChoiceSlot(null)}>
          <DialogContent className="max-w-sm p-5 gap-3 rounded-none" style={{ border: RULE }}>
            <DialogHeader><DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em]">Slot {choiceSlot.SlotNo}</DialogTitle></DialogHeader>
            <button onClick={() => { setSellSlot(choiceSlot); setChoiceSlot(null); }} className={`${KEY_INK} h-auto py-3 px-4 !justify-start text-left flex-col !items-start`}>
              Sell now <span className="normal-case tracking-normal font-normal text-[0.6875rem] opacity-80">Sell it to a customer straight away</span>
            </button>
            <button onClick={() => { setHoldSlot(choiceSlot); setChoiceSlot(null); }} className={`${KEY_LINE} h-auto py-3 px-4 !justify-start text-left flex-col !items-start`}>
              Hold <span className="normal-case tracking-normal font-normal text-[0.6875rem] text-muted-foreground">Keep it for a customer for a few days</span>
            </button>
          </DialogContent>
        </Dialog>
      )}
      {sellSlot && <SellDialog slot={sellSlot} projectId={projectId} onClose={() => setSellSlot(null)} />}
      {holdSlot && (
        <PlaceHoldDialog entityType="Parking" entityId={holdSlot.Id} label={`slot ${holdSlot.SlotNo}`} projectId={projectId}
          canPlace={canHold} onDone={() => qc.invalidateQueries({ queryKey: ["parking-matrix"] })} onClose={() => setHoldSlot(null)} />
      )}
      {infoSlot && <TileInfoDialog slot={infoSlot} onClose={() => setInfoSlot(null)} />}
    </>
  );
}

export default ParkingMatrixPage;
