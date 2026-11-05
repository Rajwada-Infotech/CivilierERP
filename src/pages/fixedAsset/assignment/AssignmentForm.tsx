// New / edit assignment. A new assignment hands an FA Item Code to its first user; after that the asset moves between
// people through User-Wise Asset Transfer. Editing keeps the asset; an assignment made by a transfer keeps its user too.
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Check, ImagePlus, Loader2 } from "lucide-react";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { DateInput } from "@/components/ui/date-input";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { getTransferUsers, type TransferUser } from "@/api/assetTransferApi";
import {
  createAssignment, getAssignableAssets, getAssignment, updateAssignment,
  type AssignableAsset, type AssignmentDetail,
} from "@/api/fixedAssetAssignmentApi";
import { Block, Field, INP, KEY_INK, KEY_LINE, LBL, READ_ONLY, RULE, ensureArray, fmtDate } from "../record/config";
import { deriveFinYear, todayLocal } from "../tagging/config";
import { AssetPicker, UserMark, UserPicker } from "./pickers";

const REFRESH = ["fixed-asset-assignments", "fixed-asset-assignment", "fixed-asset-assignable-assets", "fixed-assets", "fixed-asset-dashboard"];
const IMAGE_MAX_BYTES = 400 * 1024;

export function AssignmentForm({ editingId, onClose }: { editingId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { finYears } = useFinYear();
  const isEdit = editingId != null;
  const [docDate, setDocDate] = useState(todayLocal());
  const [finYear, setFinYear] = useState(() => deriveFinYear(todayLocal(), finYears) || finYears.find((f) => f.status === "Active")?.year || "");
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [userId, setUserId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [userImage, setUserImage] = useState<string | null>(null);
  const [camOpen, setCamOpen] = useState(false);

  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: allProjects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const { data: usersRaw = [] } = useQuery({ queryKey: ["asset-transfer-users"], queryFn: getTransferUsers });
  const { data: assignable = [], isLoading: loadingAssets } = useQuery({ queryKey: ["fixed-asset-assignable-assets"], queryFn: getAssignableAssets, enabled: !isEdit });
  const { data: detail } = useQuery<AssignmentDetail>({ queryKey: ["fixed-asset-assignment", editingId], queryFn: () => getAssignment(editingId!), enabled: isEdit });
  const users = ensureArray<TransferUser>(usersRaw);

  // An assignment being edited fills the form once it loads.
  useEffect(() => {
    if (!detail) return;
    setDocDate(detail.DocDate?.slice(0, 10) || "");
    setFinYear(detail.FinYear || "");
    setCompanyId(String(detail.CompanyId || ""));
    setProjectId(String(detail.ProjectId || ""));
    setAssetId(String(detail.AssetId ?? ""));
    setUserId(String(detail.UserId || ""));
    setResponsibleUserId(String(detail.ResponsibleUserId || ""));
    setRemarks(detail.Remarks || "");
    setUserImage(detail.UserImage || null);
  }, [detail]);
  // Financial years can arrive after the form opens: a new assignment then takes the one its date falls in.
  useEffect(() => {
    if (!isEdit && !finYear && finYears.length) setFinYear(deriveFinYear(docDate, finYears) || finYears.find((f) => f.status === "Active")?.year || "");
  }, [finYears]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTransfer = !!detail?.SourceTransferId;

  const projects = useMemo(
    () => (companyId ? ensureArray<ProjectCompanyLike & { id: number; label: string }>(allProjects).filter((p) => projectBelongsToCompany(p, companyId)) : []),
    [allProjects, companyId],
  );
  // The codes on offer follow the company and project once picked.
  const assets = useMemo(
    () => ensureArray<AssignableAsset>(assignable).filter((a) => (!companyId || String(a.CompanyId) === companyId) && (!projectId || String(a.ProjectId) === projectId)),
    [assignable, companyId, projectId],
  );
  const asset = assets.find((a) => String(a.AssetId) === assetId) || null;
  const user = users.find((u) => String(u.id) === userId) || null;

  const pickAsset = (a: AssignableAsset) => {
    setAssetId(String(a.AssetId));
    // Picking a code first fills in where it is.
    if (!companyId && a.CompanyId) setCompanyId(String(a.CompanyId));
    if (!projectId && a.ProjectId) setProjectId(String(a.ProjectId));
  };

  const readImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return void toast.error("Use a JPG, PNG, WEBP or GIF picture.");
    if (file.size > IMAGE_MAX_BYTES) return void toast.error("The picture is over 400 KB.");
    const reader = new FileReader();
    reader.onload = () => setUserImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const done = (msg: string) => {
    toast.success(msg);
    REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onClose();
  };
  const createMut = useMutation({ mutationFn: createAssignment, onSuccess: (r) => done(`Assigned: ${r.docNo}`), onError: (e: Error) => toast.error(e.message) });
  const updateMut = useMutation({
    mutationFn: (d: Parameters<typeof updateAssignment>[1]) => updateAssignment(editingId!, d),
    onSuccess: () => done("Assignment updated"),
    onError: (e: Error) => toast.error(e.message),
  });
  const saving = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    if (!docDate) return toast.error("Enter the date.");
    if (!finYear) return toast.error("Pick the financial year.");
    if (!userId) return toast.error("Pick who gets the asset.");
    if (!responsibleUserId) return toast.error("Pick the responsible person.");
    if (isEdit) {
      updateMut.mutate({ docDate, finYear, userId: Number(userId), responsibleUserId: Number(responsibleUserId), userImage, remarks: remarks || undefined });
      return;
    }
    if (!companyId) return toast.error("Pick the company.");
    if (!projectId) return toast.error("Pick the project.");
    if (!asset) return toast.error("Pick the FA Item Code.");
    createMut.mutate({
      docDate, finYear, companyId: Number(companyId), projectId: Number(projectId), assetId: asset.AssetId,
      userId: Number(userId), responsibleUserId: Number(responsibleUserId), userImage: userImage || undefined, remarks: remarks || undefined,
    });
  };

  if (isEdit && !detail) return <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        <Block title="Asset">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Company" required>
              <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); setAssetId(""); }} className={INP} disabled={isEdit}>
                <option value="">Select company…</option>
                {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Project" required>
              <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setAssetId(""); }} className={INP} disabled={!companyId || isEdit}>
                <option value="">Select project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field
              label="FA Item Code"
              required
              className="sm:col-span-2"
              note={
                isEdit
                  ? "The asset of an assignment can't change: delete it and make a new one instead."
                  : !loadingAssets && assets.length === 0
                    ? `No unassigned FA Item Code${companyId ? " here" : ""}. A code is assigned once; after that it moves through User-Wise Asset Transfer.`
                    : "Codes that have never been assigned"
              }
            >
              {isEdit ? (
                <div className={READ_ONLY}><span className="truncate"><span className="font-heading tabular-nums">{detail?.FAItemCode || "—"}</span> · {detail?.AssetName || "—"}</span></div>
              ) : (
                <AssetPicker assets={assets} value={assetId} onSelect={pickAsset} loading={loadingAssets} />
              )}
            </Field>
          </div>
        </Block>

        <Block title="People">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Assigned to" required note={fromTransfer ? "Set by the User-Wise Asset Transfer that made this assignment; change it there." : "Who has the asset"}>
              <UserPicker users={users} value={userId} onChange={setUserId} placeholder="Search people…" disabled={fromTransfer} />
            </Field>
            <Field label="Responsible person" required note="Who answers for the asset; can differ from who uses it">
              <UserPicker users={users} value={responsibleUserId} onChange={setResponsibleUserId} placeholder="Search people…" />
            </Field>
            <Field label="Date" required>
              <DateInput value={docDate} onChange={(e) => { setDocDate(e.target.value); const fy = deriveFinYear(e.target.value, finYears); if (fy) setFinYear(fy); }} className={INP} />
            </Field>
            <Field label="Financial year" required note="Follows the date; change it if needed">
              <select value={finYear} onChange={(e) => setFinYear(e.target.value)} className={INP}>
                <option value="">Select year…</option>
                {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
              </select>
            </Field>
            <Field label="Remarks" className="sm:col-span-2">
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" className={INP} />
            </Field>
          </div>
          <div>
            <p className={`${LBL} mb-1.5`}>Photo of the person with the asset</p>
            <div className="flex flex-wrap items-center gap-4">
              {userImage ? (
                <img src={userImage} alt="With the asset" className="h-20 w-20 object-cover shrink-0" style={{ border: RULE }} />
              ) : (
                <span className="h-20 w-20 shrink-0 inline-flex items-center justify-center text-[0.625rem] text-muted-foreground" style={{ border: "1px dashed hsl(var(--foreground) / 0.4)" }}>No photo</span>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setCamOpen(true)} className={`${KEY_LINE} h-9 px-3`}><Camera size={13} /> {userImage ? "Retake" : "Camera"}</button>
                <label className={`${KEY_LINE} h-9 px-3 cursor-pointer`}>
                  <ImagePlus size={13} /> {userImage ? "Change" : "Upload"}
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={readImage} />
                </label>
                {userImage && <button type="button" onClick={() => setUserImage(null)} className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}>Remove</button>}
              </div>
              <p className="text-[0.6875rem] text-muted-foreground w-full">Optional; under 400 KB.</p>
            </div>
          </div>
        </Block>
      </div>

      <aside className="bg-card xl:sticky xl:top-20" style={{ border: RULE }}>
        <div className="px-4 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>{isEdit ? `Editing ${detail?.DocNo || ""}` : "New assignment"}</p>
          <p className="font-heading text-base font-bold text-foreground truncate">{(isEdit ? detail?.AssetName : asset?.AssetName) || "No asset yet"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{(isEdit ? detail?.FAItemCode : asset?.FAItemCode) || "Pick an FA Item Code"}</p>
        </div>
        <div className="px-4 py-3 space-y-3">
          {userImage && <img src={userImage} alt="" className="w-full h-32 object-cover" style={{ border: RULE }} />}
          <div className="flex items-center gap-2">
            {user ? <UserMark name={user.name} avatarUrl={user.avatar_url} size={28} /> : <UserMark name="?" size={28} />}
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{user?.name || "No one yet"}</p>
              <p className={LBL}>Assigned to</p>
            </div>
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">{docDate ? fmtDate(docDate) : "No date"}{finYear ? ` · ${finYear}` : ""}</p>
        </div>
        <div className="px-4 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-10 px-3 flex-1`}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </aside>

      {camOpen && (
        <CameraCaptureModal
          onClose={() => setCamOpen(false)}
          onCapture={(dataUrl) => {
            if (dataUrl.length > 550_000) return void toast.error("The photo is too large; take it again in better light.");
            setUserImage(dataUrl);
          }}
        />
      )}
    </div>
  );
}
