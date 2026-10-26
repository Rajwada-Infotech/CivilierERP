// New / edit transfer: move a fixed asset from the person who has it to someone else. Saving also records an
// assignment to the new holder (shown on Assignment), and the asset's custodian follows.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, ChevronsUpDown, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DateInput } from "@/components/ui/date-input";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { getDepartmentOptions, type DepartmentOption } from "@/api/departmentMasterApi";
import {
  createAssetTransfer, getAssetTransfer, getTransferUsers, getTransferableAssets, setAssetPicture, updateAssetTransfer,
  type TransferDetail, type TransferUser, type TransferableAsset,
} from "@/api/assetTransferApi";
import { Block, Field, INP, KEY_INK, KEY_LINE, LBL, READ_ONLY, RULE, ensureArray, fmtDate } from "../record/config";
import { deriveFinYear, todayLocal } from "../tagging/config";
import { UserMark, UserPicker } from "../assignment/pickers";

const REFRESH = ["asset-transfers", "asset-transfer", "asset-transfer-transferable-assets", "fixed-asset-assignments", "fixed-asset-assignment", "fixed-assets", "fixed-asset-dashboard"];
const PICTURE_ACCEPT = "image/jpeg,image/jpg,image/png,image/webp";
const PICTURE_MAX_BYTES = 4 * 1024 * 1024;

function AssetPicker({ assets, value, onSelect, loading, disabled }: { assets: TransferableAsset[]; value: string; onSelect: (a: TransferableAsset) => void; loading?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const picked = assets.find((a) => String(a.AssetId) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button type="button" role="combobox" aria-expanded={open} disabled={disabled} className={`${INP} flex items-center justify-between gap-2 text-left`}>
          <span className="truncate">
            {picked ? <><span className="font-heading tabular-nums">{picked.FAItemCode}</span> · {picked.AssetName}</> : <span className="text-muted-foreground">{disabled ? "Pick the project first" : "Search FA Item Code…"}</span>}
          </span>
          <ChevronsUpDown size={14} className="shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-none" align="start">
        <Command>
          <CommandInput placeholder="Search FA Item Code, asset or holder…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs"><Loader2 size={13} className="animate-spin" /> Loading…</div>
            ) : (
              <>
                <CommandEmpty>No asset here that someone holds.</CommandEmpty>
                <CommandGroup>
                  {assets.map((a) => (
                    <CommandItem key={a.AssetId} value={`${a.FAItemCode} ${a.AssetName} ${a.CustodianName ?? ""}`} onSelect={() => { onSelect(a); setOpen(false); }}
                      className="rounded-none data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground">
                      <span className="flex flex-col min-w-0">
                        <span className="font-heading tabular-nums text-xs font-semibold truncate">{a.FAItemCode}</span>
                        <span className="text-xs truncate">{a.AssetName}{a.AssetCategory ? ` (${a.AssetCategory})` : ""}</span>
                        <span className="text-[0.6875rem] text-muted-foreground truncate">{a.CustodianName ? `With ${a.CustodianName}` : "No holder"}</span>
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

export function TransferForm({ editingId, onClose }: { editingId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { finYears } = useFinYear();
  const isEdit = editingId != null;
  const today = todayLocal();
  const [docDate, setDocDate] = useState(today);
  const [transferDate, setTransferDate] = useState(today);
  const [finYear, setFinYear] = useState(() => deriveFinYear(today, finYears) || finYears.find((f) => f.status === "Active")?.year || "");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [remarks, setRemarks] = useState("");
  // undefined: show the asset's own picture; a value: a change just saved from this form.
  const [picture, setPicture] = useState<string | null | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: allProjects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const { data: usersRaw = [] } = useQuery({ queryKey: ["asset-transfer-users"], queryFn: getTransferUsers });
  const { data: departments = [] } = useQuery({ queryKey: ["department-master"], queryFn: getDepartmentOptions });
  // Every asset someone holds in the project, whatever year it was recorded in: the transfer's financial year is the
  // document's, not the asset's (filtering by it hid every asset recorded in an earlier year).
  const { data: assetsRaw = [], isLoading: loadingAssets } = useQuery({
    queryKey: ["asset-transfer-transferable-assets", companyId, projectId],
    queryFn: () => getTransferableAssets({ projectId: Number(projectId), companyId: companyId ? Number(companyId) : undefined }),
    enabled: !!projectId,
  });
  const { data: detail } = useQuery<TransferDetail>({ queryKey: ["asset-transfer", editingId], queryFn: () => getAssetTransfer(editingId!), enabled: isEdit });

  useEffect(() => {
    if (!detail) return;
    setDocDate(detail.DocDate?.slice(0, 10) || "");
    setTransferDate(detail.TransferDate?.slice(0, 10) || "");
    setFinYear(detail.FinYear || "");
    setCompanyId(String(detail.CompanyId || ""));
    setProjectId(String(detail.ProjectId || ""));
    setAssetId(String(detail.AssetId ?? ""));
    setFromUserId(String(detail.FromUserId || ""));
    setToUserId(String(detail.ToUserId || ""));
    setDepartmentId(String(detail.DepartmentId || ""));
    setRemarks(detail.Remarks || "");
  }, [detail]);
  useEffect(() => {
    if (!isEdit && !finYear && finYears.length) setFinYear(deriveFinYear(transferDate, finYears) || finYears.find((f) => f.status === "Active")?.year || "");
  }, [finYears]); // eslint-disable-line react-hooks/exhaustive-deps

  const users = ensureArray<TransferUser>(usersRaw);
  const assets = ensureArray<TransferableAsset>(assetsRaw);
  const activeDepartments = ensureArray<DepartmentOption>(departments).filter((d) => d.IsActive);
  const projects = useMemo(
    () => (companyId ? ensureArray<ProjectCompanyLike & { id: number; label: string }>(allProjects).filter((p) => projectBelongsToCompany(p, companyId)) : []),
    [allProjects, companyId],
  );
  const asset = assets.find((a) => String(a.AssetId) === assetId) || null;
  const fromUser = users.find((u) => String(u.id) === fromUserId) || null;
  const toUser = users.find((u) => String(u.id) === toUserId) || null;
  const assetPicture = picture !== undefined ? picture : asset?.PictureBase64 || null;

  const pickAsset = (a: TransferableAsset) => {
    setPicture(undefined);
    setAssetId(String(a.AssetId));
    setFromUserId(a.CustodianUserId ? String(a.CustodianUserId) : "");
    setToUserId("");
    setDepartmentId("");
  };
  const pickTo = (id: string) => {
    setToUserId(id);
    // The receiver's own department, when they have one.
    const u = users.find((x) => String(x.id) === id);
    setDepartmentId(u?.DepartmentId ? String(u.DepartmentId) : "");
  };

  // The picture belongs to the asset, not the transfer: it is saved on the asset straight away.
  const pictureMut = useMutation({
    mutationFn: (value: string | null) => setAssetPicture(Number(assetId), value),
    onSuccess: (_r, value) => {
      setPicture(value);
      toast.success(value ? "Picture saved on the asset" : "Picture removed from the asset");
      qc.invalidateQueries({ queryKey: ["asset-transfer-transferable-assets"] });
      qc.invalidateQueries({ queryKey: ["fixed-assets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const readPicture = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) && !PICTURE_ACCEPT.includes(file.type)) return void toast.error("Use a JPG, JPEG, PNG or WEBP picture.");
    if (file.size > PICTURE_MAX_BYTES) return void toast.error("The picture is over 4 MB.");
    const reader = new FileReader();
    reader.onload = () => pictureMut.mutate(String(reader.result || ""));
    reader.onerror = () => toast.error("Could not read the picture.");
    reader.readAsDataURL(file);
  };

  const done = (msg: string) => {
    toast.success(msg);
    REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onClose();
  };
  const createMut = useMutation({ mutationFn: createAssetTransfer, onSuccess: (r) => done(`Transferred: ${r.docNo}`), onError: (e: Error) => toast.error(e.message) });
  const updateMut = useMutation({ mutationFn: (d: Parameters<typeof updateAssetTransfer>[1]) => updateAssetTransfer(editingId!, d), onSuccess: () => done("Transfer updated"), onError: (e: Error) => toast.error(e.message) });
  const saving = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    if (!companyId) return toast.error("Pick the company.");
    if (!projectId) return toast.error("Pick the project.");
    if (!finYear) return toast.error("Pick the financial year.");
    if (!docDate || !transferDate) return toast.error("Enter both dates.");
    if (!assetId) return toast.error("Pick the FA Item Code.");
    if (!isEdit && !asset) return toast.error("That asset can no longer be transferred.");
    if (!fromUserId) return toast.error("The asset has no holder to transfer from.");
    if (!toUserId) return toast.error("Pick who receives it.");
    if (fromUserId === toUserId) return toast.error("It is already with that person.");
    if (!departmentId) return toast.error("Pick the department.");
    if (!remarks.trim()) return toast.error("Say why it is being transferred.");
    const payload = {
      docDate, transferDate, companyId: Number(companyId), projectId: Number(projectId), finYear, assetId: Number(assetId),
      fromUserId: Number(fromUserId), toUserId: Number(toUserId), departmentId: Number(departmentId), remarks: remarks.trim(),
    };
    if (isEdit) updateMut.mutate(payload);
    else createMut.mutate(payload);
  };

  if (isEdit && !detail) return <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        <Block title="Document">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Field label="Company" required>
              <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); setAssetId(""); setFromUserId(""); setToUserId(""); }} className={INP}>
                <option value="">Select company…</option>
                {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Project" required>
              <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setAssetId(""); setFromUserId(""); setToUserId(""); }} className={INP} disabled={!companyId}>
                <option value="">Select project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Doc no">
              <div className={READ_ONLY}>{detail?.DocNo || "Given on save"}</div>
            </Field>
            <Field label="Document date" required>
              <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} className={INP} />
            </Field>
            <Field label="Transfer date" required>
              <DateInput value={transferDate} onChange={(e) => { setTransferDate(e.target.value); const fy = deriveFinYear(e.target.value, finYears); if (fy) setFinYear(fy); }} className={INP} />
            </Field>
            <Field label="Financial year" required note="Follows the transfer date">
              <select value={finYear} onChange={(e) => setFinYear(e.target.value)} className={INP}>
                <option value="">Select year…</option>
                {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
              </select>
            </Field>
          </div>
        </Block>

        <Block title="Transfer">
          <Field label="FA Item Code" required note={projectId && !loadingAssets && assets.length === 0 ? "No asset in this project has a holder: assign it first on Assignment." : "Assets someone holds in this project"}>
            {isEdit ? (
              <div className={READ_ONLY}><span className="truncate"><span className="font-heading tabular-nums">{detail?.FAItemCode || "—"}</span> · {detail?.AssetName || "—"}</span></div>
            ) : (
              <AssetPicker assets={assets} value={assetId} onSelect={pickAsset} loading={loadingAssets} disabled={!projectId} />
            )}
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="From" required={isEdit} note={isEdit ? undefined : "Whoever has it now"}>
              {isEdit ? (
                <UserPicker users={users} value={fromUserId} onChange={setFromUserId} placeholder="Search people…" />
              ) : (
                <div className={READ_ONLY}>
                  {fromUser ? <span className="flex items-center gap-2 min-w-0 text-foreground"><UserMark name={fromUser.name} avatarUrl={fromUser.avatar_url} size={20} /><span className="truncate">{fromUser.name}</span></span> : assetId ? "No holder" : "Pick an asset first"}
                </div>
              )}
            </Field>
            <Field label="To" required>
              <UserPicker users={users.filter((u) => String(u.id) !== fromUserId)} value={toUserId} onChange={pickTo} placeholder="Search people…" disabled={!fromUserId} />
            </Field>
            <Field label="Department" required note={toUser?.DepartmentId ? "The receiver's department; change it if needed" : undefined}>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={INP} disabled={!toUserId}>
                <option value="">Select department…</option>
                {activeDepartments.map((d) => <option key={d.Id} value={d.Id}>{d.DepartmentName}</option>)}
              </select>
            </Field>
            <Field label="Why" required>
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Reason for the transfer" className={INP} />
            </Field>
          </div>
          {assetId && (
            <div>
              <p className={`${LBL} mb-1.5`}>Picture of the asset</p>
              <input ref={fileRef} type="file" accept={PICTURE_ACCEPT} className="hidden" onChange={(e) => { readPicture(e.target.files?.[0]); e.target.value = ""; }} />
              <div className="flex flex-wrap items-center gap-4">
                {assetPicture ? (
                  <img src={assetPicture} alt="Asset" className="h-20 w-20 object-cover shrink-0" style={{ border: RULE }} />
                ) : (
                  <span className="h-20 w-20 shrink-0 inline-flex items-center justify-center text-[0.625rem] text-muted-foreground text-center" style={{ border: "1px dashed hsl(var(--foreground) / 0.4)" }}>No picture</span>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={pictureMut.isPending} onClick={() => fileRef.current?.click()} className={`${KEY_LINE} h-9 px-3`}>
                    {pictureMut.isPending ? <Loader2 size={12} className="animate-spin" /> : assetPicture ? <RefreshCw size={12} /> : <Upload size={12} />} {assetPicture ? "Change" : "Upload"}
                  </button>
                  {assetPicture && (
                    <button type="button" disabled={pictureMut.isPending} onClick={() => pictureMut.mutate(null)} className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}><Trash2 size={12} /> Remove</button>
                  )}
                </div>
                <p className="text-[0.6875rem] text-muted-foreground w-full">Saved on the asset at once, whether or not the transfer is saved. JPG, PNG or WEBP, up to 4 MB.</p>
              </div>
            </div>
          )}
        </Block>
      </div>

      <aside className="bg-card xl:sticky xl:top-20" style={{ border: RULE }}>
        <div className="px-4 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>{isEdit ? `Editing ${detail?.DocNo || ""}` : "New transfer"}</p>
          <p className="font-heading text-base font-bold text-foreground truncate">{(isEdit ? detail?.AssetName : asset?.AssetName) || "No asset yet"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{(isEdit ? detail?.FAItemCode : asset?.FAItemCode) || "Pick an FA Item Code"}</p>
        </div>
        <div className="px-4 py-4 flex items-center justify-between gap-2">
          <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
            <UserMark name={fromUser?.name || "?"} avatarUrl={fromUser?.avatar_url} size={32} />
            <p className="text-xs font-medium truncate max-w-full">{fromUser?.name || "—"}</p>
            <p className={LBL}>From</p>
          </div>
          <ArrowRight size={16} className="shrink-0 text-foreground" />
          <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
            <UserMark name={toUser?.name || "?"} avatarUrl={toUser?.avatar_url} size={32} />
            <p className="text-xs font-medium truncate max-w-full">{toUser?.name || "—"}</p>
            <p className={LBL}>To</p>
          </div>
        </div>
        <p className="px-4 pb-3 text-[0.6875rem] text-muted-foreground">{transferDate ? fmtDate(transferDate) : "No date"}{finYear ? ` · ${finYear}` : ""}</p>
        <div className="px-4 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-10 px-3 flex-1`}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </aside>
    </div>
  );
}
