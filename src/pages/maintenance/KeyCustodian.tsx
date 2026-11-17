// Maintenance > Key Custodian: every block and its units; a unit opens a form with its confirmed CRM booking
// (buyer, co-applicants, parking, handover) and who holds its keys.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Search, Save, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { SheetBox, SHEET_DIALOG } from "@/components/maintenance/maintParts";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
import { HrEmpty, HrError, HR_FIELD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getKeyCustodianUnits,
  getKeyCustodianUnit,
  saveKeyCustodian,
  type KeyCustodianUnitRow,
  type KeyCustodianRecord,
} from "@/api/maintenanceApi";

const blockLabel = (name: string) => (/^block[^a-z]/i.test(name) ? name : `Block ${name}`);
const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtArea = (n: number | null | undefined) => (n ? `${Number(n).toLocaleString("en-IN")} sq ft` : "—");
const fmtMoney = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");

export default function KeyCustodian() {
  usePageRights("maintenance-key-custodian");
  const [search, setSearch] = useState("");
  const [project, setProject] = useState<string>("");
  const [openUnit, setOpenUnit] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["key-custodian-units"],
    queryFn: getKeyCustodianUnits,
    staleTime: 30_000,
  });
  const units = Array.isArray(data) ? data : [];

  const projects = useMemo(() => {
    const m = new Map<string, string>();
    units.forEach((u) => m.set(String(u.ProjectId), u.ProjectName || `Project ${u.ProjectId}`));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [units]);
  useEffect(() => {
    if (!project && projects.length) setProject(projects[0][0]);
  }, [projects, project]);

  const projectName = projects.find(([id]) => id === project)?.[1] ?? "";

  // Blocks of the chosen project, each with its units (filtered by the search).
  const blocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inProject = units.filter((u) => String(u.ProjectId) === project);
    const match = (u: KeyCustodianUnitRow) =>
      !q || [u.UnitName, u.BlockName, u.ApplicantName, u.BookingNo, u.CustodianName].some((v) => (v || "").toLowerCase().includes(q));
    const map = new Map<number, { name: string; units: KeyCustodianUnitRow[]; total: number; booked: number; recorded: number }>();
    for (const u of inProject) {
      const b = map.get(u.BlockId) ?? { name: u.BlockName, units: [], total: 0, booked: 0, recorded: 0 };
      b.total++;
      if (u.BookingId) b.booked++;
      if (u.CustodianName) b.recorded++;
      if (match(u)) b.units.push(u);
      map.set(u.BlockId, b);
    }
    return [...map.entries()]
      .map(([id, b]) => ({ id, ...b, units: b.units.sort((x, y) => x.UnitName.localeCompare(y.UnitName, undefined, { numeric: true })) }))
      .filter((b) => b.units.length)
      .sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
  }, [units, project, search]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Key Custodian"]} />
      <MaintenanceShell
        title="Key Custodian"
        subtitle="Units not yet handed over — open one to see its booking confirmation and record who holds the keys until handover"
        action={
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {projects.length > 1 && (
              <select value={project} onChange={(e) => setProject(e.target.value)} className={`${HR_FIELD} sm:w-56`} aria-label="Project">
                {projects.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            )}
            <div className="relative w-full sm:w-64">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search unit, buyer, custodian…" className={`${HR_FIELD} pl-8`} />
            </div>
          </div>
        }
      >
        {isLoading && <div className="skel" style={{ height: 240 }} />}
        {error && <HrError text={(error as Error).message || "Failed to load units."} />}
        {!isLoading && !error && blocks.length === 0 && (
          <div className="bg-card" style={{ border: HR_RULE }}>
            <HrEmpty icon={KeyRound} title={search ? "No units match" : "No units found"} text={search ? "Try a different unit, buyer or custodian name." : "Every unit in this project has been handed over — handed-over units are in Customer Directory."} />
          </div>
        )}

        <div className="space-y-4">
          {blocks.map((b) => (
            <SheetBox key={b.id} title={`${projectName} · ${blockLabel(b.name)}`} note={`${b.total} unit${b.total === 1 ? "" : "s"} not handed over · ${b.booked} confirmed · keys recorded for ${b.recorded}`}>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                {b.units.map((u) => (
                  <button
                    key={u.UnitId}
                    type="button"
                    onClick={() => setOpenUnit(u.UnitId)}
                    className="text-left border border-foreground/40 hover:border-foreground hover:bg-primary/5 transition-colors px-3 py-2.5 min-w-0"
                  >
                    <p className={`text-sm font-semibold text-foreground truncate ${HR_NUM}`}>{u.UnitName}</p>
                    <p className="text-[0.6875rem] text-muted-foreground truncate">{u.ApplicantName || "No confirmed booking"}</p>
                    <div className="mt-1.5">
                      <SheetMark text={u.CustodianName ? "Keys recorded" : "Not recorded"} tone={u.CustodianName ? "done" : "draft"} />
                    </div>
                  </button>
                ))}
              </div>
            </SheetBox>
          ))}
        </div>
      </MaintenanceShell>

      {openUnit != null && <UnitDialog unitId={openUnit} onClose={() => setOpenUnit(null)} />}
    </>
  );
}

const EMPTY: KeyCustodianRecord = {
  CustodianType: "",
  CustodianName: "",
  CustodianPhone: "",
  KeyCount: null,
  KeyTagNo: "",
  HandedOverOn: "",
  HandedOverBy: "",
  Remarks: "",
};

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block space-y-1 min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <span className={HR_LBL}>{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={HR_LBL}>{label}</p>
      <p className="text-sm text-foreground break-words">{value || "—"}</p>
    </div>
  );
}

function UnitDialog({ unitId, onClose }: { unitId: number; onClose: () => void }) {
  const rights = usePageRights("maintenance-key-custodian");
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["key-custodian-unit", unitId],
    queryFn: () => getKeyCustodianUnit(unitId),
    staleTime: 0,
  });
  const [form, setForm] = useState<KeyCustodianRecord>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const c = data.custodian;
    setForm(c ? {
      ...c,
      CustodianPhone: c.CustodianPhone ?? "",
      KeyTagNo: c.KeyTagNo ?? "",
      HandedOverOn: c.HandedOverOn ? String(c.HandedOverOn).slice(0, 10) : "",
      HandedOverBy: c.HandedOverBy ?? "",
      Remarks: c.Remarks ?? "",
    } : EMPTY);
  }, [data]);

  const set = <K extends keyof KeyCustodianRecord>(k: K, v: KeyCustodianRecord[K]) => setForm((f) => ({ ...f, [k]: v }));
  const bk = data?.booking ?? null;

  // Picking Owner fills in the buyer; Co-applicant offers the booking's co-applicants.
  const onType = (t: string) => {
    if (t === "Owner" && bk) setForm((f) => ({ ...f, CustodianType: t, CustodianName: bk.ApplicantName, CustodianPhone: bk.Mobile ?? "" }));
    else set("CustodianType", t);
  };

  const editable = rights.canEdit && !data?.handedOver;
  const canSave = editable && !!form.CustodianType && !!form.CustodianName.trim();
  const save = async () => {
    setSaving(true);
    try {
      await saveKeyCustodian(unitId, form);
      toast.success("Key custodian saved");
      await queryClient.invalidateQueries({ queryKey: ["key-custodian-units"] });
      await queryClient.invalidateQueries({ queryKey: ["key-custodian-unit", unitId] });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const u = data?.unit;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`${SHEET_DIALOG} max-w-3xl w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto p-0`}>
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-foreground/20 text-left">
          <DialogTitle className="font-heading text-base font-bold">
            {u ? u.UnitName : "Unit"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {u ? [u.ProjectName, blockLabel(u.BlockName)].filter(Boolean).join(" · ") : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {isLoading && <div className="skel" style={{ height: 200 }} />}
          {error && <HrError text={(error as Error).message} />}

          {data && (
            <>
              {/* Booking confirmation, read live from CRM */}
              <SheetBox title="Booking confirmation" note={bk ? bk.BookingNo : "none"}>
                {!bk ? (
                  <p className="text-sm text-muted-foreground">This unit has no confirmed booking in CRM.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Info label="Buyer" value={bk.ApplicantName} />
                      <Info label="Mobile" value={[bk.Mobile, bk.AltMobile].filter(Boolean).join(" / ")} />
                      <Info label="Email" value={bk.Email} />
                      <Info label="Booking no" value={<span className={HR_NUM}>{bk.BookingNo}</span>} />
                      <Info label="Booking date" value={fmtDate(bk.BookingDate)} />
                      <Info label="Confirmed" value={bk.ConfirmedAt ? `${fmtDate(bk.ConfirmedAt)}${bk.ConfirmedBy ? ` · ${bk.ConfirmedBy}` : ""}` : "—"} />
                      <Info label="Company" value={bk.CompanyName} />
                      <Info label="Unit type" value={bk.UnitType} />
                      <Info label="Floor" value={bk.FloorName} />
                      <Info label="Carpet area" value={fmtArea(bk.CarpetAreaSqFt)} />
                      <Info label="Super built-up area" value={fmtArea(bk.SuperBuiltUpAreaSqFt ?? bk.AreaSqFt)} />
                      <Info label="Total value" value={<span className={HR_NUM}>{fmtMoney(bk.GrandTotal ?? bk.TotalValue)}</span>} />
                    </div>
                    {data.coApplicants.length > 0 && (
                      <div>
                        <p className={`${HR_LBL} mb-1`}>Co-applicants</p>
                        <ul className="text-sm text-foreground space-y-0.5">
                          {data.coApplicants.map((c, i) => (
                            <li key={i}>
                              {c.Name}
                              {c.Relation ? ` (${c.Relation})` : ""}
                              {c.Mobile ? <span className={`text-muted-foreground ${HR_NUM}`}> · {c.Mobile}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <Info
                        label="Parking"
                        value={data.parking.length ? data.parking.map((p) => [p.ParkingType, p.ParkingSlotNo].filter(Boolean).join(" ") + (p.Quantity > 1 ? ` ×${p.Quantity}` : "")).join(", ") : "None"}
                      />
                      <Info label="Handover" value={data.handover ? data.handover.Status : "Not scheduled"} />
                      <Info
                        label="Handover date"
                        value={data.handover ? fmtDate(data.handover.ActualHandoverDate ?? data.handover.ScheduledDate) : "—"}
                      />
                    </div>
                  </div>
                )}
              </SheetBox>

              {/* Who holds the keys */}
              <SheetBox
                title="Key custodian"
                note={data.custodian?.UpdatedAt || data.custodian?.CreatedAt
                  ? `last saved ${fmtDate(data.custodian.UpdatedAt ?? data.custodian.CreatedAt)}${data.custodian.UpdatedBy || data.custodian.CreatedBy ? ` by ${data.custodian.UpdatedBy ?? data.custodian.CreatedBy}` : ""}`
                  : undefined}
              >
                {data.handedOver && (
                  <p className="text-xs text-muted-foreground mb-3">This unit has been handed over, so its keys are with the customer. The record below is kept for reference.</p>
                )}
                <fieldset disabled={!editable} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Custodian type *">
                    <select value={form.CustodianType} onChange={(e) => onType(e.target.value)} className={HR_FIELD}>
                      <option value="">Select…</option>
                      {data.custodianTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Custodian name *">
                    {form.CustodianType === "Co-applicant" && data.coApplicants.length > 0 ? (
                      <select
                        value={form.CustodianName}
                        onChange={(e) => {
                          const c = data.coApplicants.find((x) => x.Name === e.target.value);
                          setForm((f) => ({ ...f, CustodianName: e.target.value, CustodianPhone: c?.Mobile ?? f.CustodianPhone }));
                        }}
                        className={HR_FIELD}
                      >
                        <option value="">Select…</option>
                        {data.coApplicants.map((c, i) => (
                          <option key={i} value={c.Name}>{c.Name}</option>
                        ))}
                      </select>
                    ) : (
                      <input value={form.CustodianName} onChange={(e) => set("CustodianName", e.target.value)} className={HR_FIELD} maxLength={200} />
                    )}
                  </Field>
                  <Field label="Phone">
                    <input value={form.CustodianPhone ?? ""} onChange={(e) => set("CustodianPhone", e.target.value)} className={`${HR_FIELD} ${HR_NUM}`} maxLength={20} inputMode="tel" />
                  </Field>
                  <Field label="Number of keys">
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={form.KeyCount ?? ""}
                      onChange={(e) => set("KeyCount", e.target.value === "" ? null : parseInt(e.target.value, 10))}
                      className={`${HR_FIELD} ${HR_NUM}`}
                    />
                  </Field>
                  <Field label="Key tag no">
                    <input value={form.KeyTagNo ?? ""} onChange={(e) => set("KeyTagNo", e.target.value)} className={HR_FIELD} maxLength={50} />
                  </Field>
                  <Field label="Handed over on">
                    <DateInput value={form.HandedOverOn ?? ""} onChange={(e) => set("HandedOverOn", e.target.value)} className={HR_FIELD} />
                  </Field>
                  <Field label="Handed over by" wide>
                    <input value={form.HandedOverBy ?? ""} onChange={(e) => set("HandedOverBy", e.target.value)} className={HR_FIELD} maxLength={150} />
                  </Field>
                  <Field label="Remarks" wide>
                    <textarea value={form.Remarks ?? ""} onChange={(e) => set("Remarks", e.target.value)} rows={3} maxLength={1000} className={`${HR_FIELD} h-auto py-2`} />
                  </Field>
                </fieldset>
              </SheetBox>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-foreground/20">
          <button type="button" onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>
            <X size={12} /> Close
          </button>
          {editable && (
            <button type="button" disabled={!canSave || saving} onClick={() => void save()} className={`${KEY_INK} h-9 px-4`}>
              <Save size={12} /> {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
