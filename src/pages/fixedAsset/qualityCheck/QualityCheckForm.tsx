// New / edit quality check: the asset's condition today, a photo taken now, and when to look at it again.
// The current user, their photo and the responsible person come from the asset's latest assignment.
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DateInput } from "@/components/ui/date-input";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import {
  FOLLOWUP_STATUSES, FOLLOWUP_TYPES, QUALITY_STATUSES,
  createQualityCheck, getAssetContext, getQCAssets, getQualityCheck, updateQualityCheck,
  type FollowUpStatus, type QCAsset, type QualityCheckItem, type QualityStatus,
} from "@/api/fixedAssetQualityCheckApi";
import { Block, Field, INP, KEY_INK, KEY_LINE, LBL, READ_ONLY, RULE, ensureArray, fmtDate } from "../record/config";
import { todayLocal } from "../tagging/config";
import { UserMark } from "../assignment/pickers";

export const QC_REFRESH = ["fa-quality-checks", "fa-quality-check", "fixed-asset-dashboard"];

/** Where a new check starts: blank, or a follow-up of an earlier check on the same asset. */
export type QCStart = { followUpOf: QualityCheckItem } | null;

function AssetPicker({ assets, value, onSelect, loading }: { assets: QCAsset[]; value: string; onSelect: (a: QCAsset) => void; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  const picked = assets.find((a) => String(a.AssetId) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} className={`${INP} flex items-center justify-between gap-2 text-left`}>
          <span className="truncate">{picked ? <><span className="font-heading tabular-nums">{picked.FAItemCode}</span> · {picked.AssetName}</> : <span className="text-muted-foreground">Search FA Item Code…</span>}</span>
          <ChevronsUpDown size={14} className="shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-none" align="start">
        <Command>
          <CommandInput placeholder="Search FA Item Code or asset…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs"><Loader2 size={13} className="animate-spin" /> Loading…</div>
            ) : (
              <>
                <CommandEmpty>No fixed asset here.</CommandEmpty>
                <CommandGroup>
                  {assets.map((a) => (
                    <CommandItem key={a.AssetId} value={`${a.FAItemCode} ${a.AssetName}`} onSelect={() => { onSelect(a); setOpen(false); }}
                      className="rounded-none data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground">
                      <span className="flex flex-col min-w-0">
                        <span className="font-heading tabular-nums text-xs font-semibold truncate">{a.FAItemCode}</span>
                        <span className="text-xs truncate">{a.AssetName}{a.AssetCategory ? ` (${a.AssetCategory})` : ""}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function QualityCheckForm({ editingId, start, onClose, onView }: { editingId: number | null; start: QCStart; onClose: () => void; onView: (src: string, label: string) => void }) {
  const qc = useQueryClient();
  const isEdit = editingId != null;
  const prev = start?.followUpOf ?? null;
  const [docDate, setDocDate] = useState(todayLocal());
  const [companyId, setCompanyId] = useState(prev ? String(prev.CompanyId || "") : "");
  const [projectId, setProjectId] = useState(prev ? String(prev.ProjectId || "") : "");
  const [assetId, setAssetId] = useState(prev ? String(prev.AssetId ?? "") : "");
  const [qualityStatus, setQualityStatus] = useState<QualityStatus | "">("");
  const [remarks, setRemarks] = useState("");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("");
  const [followUpType, setFollowUpType] = useState(prev ? "Recheck" : "");
  const [followUpRemarks, setFollowUpRemarks] = useState("");
  const [followUpStatus, setFollowUpStatus] = useState<FollowUpStatus>("Pending");
  const [lastFollowUpDate, setLastFollowUpDate] = useState(prev ? (prev.NextFollowUpDate || prev.DocDate || "").slice(0, 10) : "");
  const [nextActionNotes, setNextActionNotes] = useState("");
  // undefined: no new photo taken here (the record keeps its own, or a new one starts without).
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [camOpen, setCamOpen] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: allProjects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const { data: assetsRaw = [], isLoading: loadingAssets } = useQuery({
    queryKey: ["fa-qc-assets", companyId, projectId],
    queryFn: () => getQCAssets({ companyId: companyId ? Number(companyId) : undefined, projectId: projectId ? Number(projectId) : undefined }),
    enabled: !isEdit,
  });
  const { data: detail } = useQuery<QualityCheckItem>({ queryKey: ["fa-quality-check", editingId], queryFn: () => getQualityCheck(editingId!), enabled: isEdit });
  const { data: ctx, isFetching: ctxLoading } = useQuery({ queryKey: ["fa-qc-asset-context", assetId], queryFn: () => getAssetContext(Number(assetId)), enabled: !!assetId });

  useEffect(() => {
    if (!detail) return;
    setDocDate(detail.DocDate?.slice(0, 10) || "");
    setCompanyId(String(detail.CompanyId || ""));
    setProjectId(String(detail.ProjectId || ""));
    setAssetId(String(detail.AssetId ?? ""));
    setQualityStatus(detail.QualityStatus);
    setRemarks(detail.Remarks || "");
    setNextFollowUpDate(detail.NextFollowUpDate?.slice(0, 10) || "");
    setFollowUpType(detail.FollowUpType || "");
    setFollowUpRemarks(detail.FollowUpRemarks || "");
    setFollowUpStatus(detail.FollowUpStatus);
    setLastFollowUpDate(detail.LastFollowUpDate?.slice(0, 10) || "");
    setNextActionNotes(detail.NextActionNotes || "");
  }, [detail]);

  const projects = useMemo(
    () => (companyId ? ensureArray<ProjectCompanyLike & { id: number; label: string }>(allProjects).filter((p) => projectBelongsToCompany(p, companyId)) : []),
    [allProjects, companyId],
  );
  const assets = ensureArray<QCAsset>(assetsRaw);
  const pickAsset = (a: QCAsset) => {
    setPhoto(undefined);
    setAssetId(String(a.AssetId));
    if (!companyId && a.CompanyId) setCompanyId(String(a.CompanyId));
    if (!projectId && a.ProjectId) setProjectId(String(a.ProjectId));
  };

  // On edit, this record's own photo; on a new check, the latest earlier one, shown faded for reference only.
  const stored = isEdit ? detail?.ItemPicture ?? null : ctx?.itemPicture ?? null;
  const shownPhoto = photo !== undefined ? photo : stored;
  const isReference = !isEdit && photo === undefined && !!stored;
  const itemName = ctx?.itemName ?? detail?.ItemName ?? null;
  const currentUser = ctx?.currentUserName ?? detail?.CurrentUserName ?? null;
  const responsible = ctx?.responsibleUserName ?? detail?.ResponsibleUserName ?? null;

  const done = (msg: string) => {
    toast.success(msg);
    QC_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onClose();
  };
  const createMut = useMutation({ mutationFn: createQualityCheck, onSuccess: (r) => done(`Quality check saved: ${r.docNo}`), onError: (e: Error) => toast.error(e.message) });
  const updateMut = useMutation({ mutationFn: (d: Parameters<typeof updateQualityCheck>[1]) => updateQualityCheck(editingId!, d), onSuccess: () => done("Quality check updated"), onError: (e: Error) => toast.error(e.message) });
  const saving = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    if (!assetId) return toast.error("Pick the FA Item Code.");
    if (!qualityStatus) return toast.error("Pick the condition.");
    if (!nextFollowUpDate) return toast.error("Enter when to check it next.");
    const payload = {
      docDate: docDate || undefined,
      companyId: companyId ? Number(companyId) : undefined,
      projectId: projectId ? Number(projectId) : undefined,
      assetId: Number(assetId),
      qualityStatus,
      remarks: remarks || undefined,
      // Only a photo taken on this form is sent; a record keeps its own otherwise.
      ...(photo !== undefined ? { itemPicture: photo } : {}),
      nextFollowUpDate,
      followUpType: followUpType || undefined,
      followUpRemarks: followUpRemarks || undefined,
      responsibleUserId: ctx?.responsibleUserId ?? detail?.ResponsibleUserId ?? null,
      followUpStatus,
      lastFollowUpDate: lastFollowUpDate || undefined,
      nextActionNotes: nextActionNotes || undefined,
    };
    if (isEdit) updateMut.mutate(payload);
    else createMut.mutate(payload);
  };

  if (isEdit && !detail) return <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>;

  const Person = ({ name, avatar, empty }: { name: string | null; avatar?: string | null; empty: string }) => (
    <div className={READ_ONLY}>
      {ctxLoading && assetId ? <Loader2 size={13} className="animate-spin" /> : name ? (
        <span className="flex items-center gap-2 min-w-0 text-foreground"><UserMark name={name} avatarUrl={avatar} size={20} /><span className="truncate">{name}</span></span>
      ) : <span>{assetId ? empty : "Pick an asset first"}</span>}
    </div>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        <Block title="Asset" note={prev ? `Follow-up of ${prev.DocNo || "an earlier check"}` : undefined}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Field label="Company">
              <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); setAssetId(""); }} className={INP} disabled={isEdit || !!prev}>
                <option value="">All companies</option>
                {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Project">
              <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setAssetId(""); }} className={INP} disabled={!companyId || isEdit || !!prev}>
                <option value="">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Check date">
              <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} className={INP} />
            </Field>
            <Field label="FA Item Code" required className="sm:col-span-2 lg:col-span-3" note={!isEdit && !prev ? "Company and project narrow the list; picking a code first fills them in" : undefined}>
              {isEdit || prev ? (
                <div className={READ_ONLY}><span className="truncate"><span className="font-heading tabular-nums">{detail?.FAItemCode || prev?.FAItemCode || "—"}</span> · {itemName || "—"}</span></div>
              ) : (
                <AssetPicker assets={assets} value={assetId} onSelect={pickAsset} loading={loadingAssets} />
              )}
            </Field>
            <Field label="Has it now" note="From the latest assignment">
              <Person name={currentUser} avatar={ctx?.currentUserAvatar} empty="Not assigned to anyone" />
            </Field>
            <Field label="Condition" required>
              <select value={qualityStatus} onChange={(e) => setQualityStatus(e.target.value as QualityStatus)} className={INP}>
                <option value="">Select…</option>
                {QUALITY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Remarks">
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" className={INP} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <p className={`${LBL} mb-1.5`}>Photo of the asset</p>
              <div className="flex items-center gap-3">
                {shownPhoto ? (
                  <button type="button" onClick={() => onView(shownPhoto, "Photo of the asset")} className="shrink-0" title="View full size">
                    <img src={shownPhoto} alt="Asset" className={`h-20 w-20 object-cover ${isReference ? "opacity-50" : ""}`} style={{ border: RULE }} />
                  </button>
                ) : (
                  <span className="h-20 w-20 shrink-0 inline-flex items-center justify-center text-[0.625rem] text-muted-foreground" style={{ border: "1px dashed hsl(var(--foreground) / 0.4)" }}>No photo</span>
                )}
                <div className="space-y-1.5 min-w-0">
                  <button type="button" disabled={!assetId} onClick={() => setCamOpen(true)} className={`${KEY_LINE} h-9 px-3`}><Camera size={13} /> {shownPhoto && !isReference ? "Retake" : "Take photo"}</button>
                  <p className="text-[0.6875rem] text-muted-foreground">
                    {!assetId ? "Pick an asset first"
                      : photo !== undefined ? "New photo, saved with this check"
                      : isReference ? `Earlier photo${ctx?.itemPictureFromDocNo ? ` from ${ctx.itemPictureFromDocNo}` : ""}${ctx?.itemPictureFromDate ? `, ${fmtDate(ctx.itemPictureFromDate)}` : ""}; for reference only`
                      : shownPhoto ? "This check's photo" : "Taken with the camera only"}
                  </p>
                </div>
              </div>
            </div>
            <div>
              <p className={`${LBL} mb-1.5`}>Photo of the person with it</p>
              <div className="flex items-center gap-3">
                {ctx?.userPhoto ? (
                  <button type="button" onClick={() => onView(ctx.userPhoto!, "Photo of the person with it")} className="shrink-0" title="View full size">
                    <img src={ctx.userPhoto} alt="Person" className="h-20 w-20 object-cover" style={{ border: RULE }} />
                  </button>
                ) : (
                  <span className="h-20 w-20 shrink-0 inline-flex items-center justify-center text-[0.625rem] text-muted-foreground" style={{ border: "1px dashed hsl(var(--foreground) / 0.4)" }}>None</span>
                )}
                <p className="text-[0.6875rem] text-muted-foreground">From the assignment; change it on Assignment.</p>
              </div>
            </div>
          </div>
        </Block>

        <Block title="Follow-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Field label="Check again on" required>
              <DateInput value={nextFollowUpDate} onChange={(e) => setNextFollowUpDate(e.target.value)} className={INP} />
            </Field>
            <Field label="Type">
              <select value={followUpType} onChange={(e) => setFollowUpType(e.target.value)} className={INP}>
                <option value="">Select…</option>
                {FOLLOWUP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Responsible" note="From the latest assignment; set it on Assignment">
              <Person name={responsible} avatar={ctx?.responsibleUserAvatar} empty="No one named" />
            </Field>
            <Field label="Status">
              <select value={followUpStatus} onChange={(e) => setFollowUpStatus(e.target.value as FollowUpStatus)} className={INP}>
                {FOLLOWUP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Last checked on">
              <DateInput value={lastFollowUpDate} onChange={(e) => setLastFollowUpDate(e.target.value)} className={INP} />
            </Field>
            <Field label="Follow-up remarks">
              <input type="text" value={followUpRemarks} onChange={(e) => setFollowUpRemarks(e.target.value)} placeholder="Optional" className={INP} />
            </Field>
            <Field label="What to do next" className="sm:col-span-2 lg:col-span-3">
              <input type="text" value={nextActionNotes} onChange={(e) => setNextActionNotes(e.target.value)} placeholder="Optional" className={INP} />
            </Field>
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">The responsible person gets a reminder on the date and every day after, until the follow-up is completed or cancelled.</p>
        </Block>
      </div>

      <aside className="bg-card xl:sticky xl:top-20" style={{ border: RULE }}>
        <div className="px-4 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>{isEdit ? `Editing ${detail?.DocNo || ""}` : prev ? "Follow-up check" : "New quality check"}</p>
          <p className="font-heading text-base font-bold text-foreground truncate">{itemName || "No asset yet"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{ctx?.faItemCode || detail?.FAItemCode || "Pick an FA Item Code"}</p>
        </div>
        <dl className="px-4 py-2 text-xs">
          {[
            ["Has it", currentUser],
            ["Condition", qualityStatus],
            ["Check again", nextFollowUpDate ? fmtDate(nextFollowUpDate) : ""],
            ["Responsible", responsible],
            ["Status", followUpStatus],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 py-1.5" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.1)" }}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium text-right truncate">{v || "—"}</dd>
            </div>
          ))}
        </dl>
        <div className="px-4 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-10 px-3 flex-1`}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </aside>

      {camOpen && <CameraCaptureModal onCapture={(d) => setPhoto(d)} onClose={() => setCamOpen(false)} />}
    </div>
  );
}
