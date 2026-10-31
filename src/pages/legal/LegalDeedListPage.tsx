import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { DocumentUpload } from "iconsax-react";
import { Plus, X, ExternalLink, ChevronRight, AlertCircle, FileText } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { usePageRights } from "@/hooks/usePageRights";
import { getLegalDeeds, createLegalDeed, type LegalDeedSummary } from "@/api/legalOperationsApi";
import { getLegalLookup } from "@/api/legalMastersApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LegalDeedListPage() {
  const rights = usePageRights("legal-deed-registrations");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [openCreateModal, setOpenCreateModal] = useState(false);

  // Form states with distinct RS & LR fields
  const [deedNo, setDeedNo] = useState("");
  const [deedYear, setDeedYear] = useState(new Date().getFullYear().toString());
  const [deedTypeId, setDeedTypeId] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [mouzaId, setMouzaId] = useState("");
  const [rsDag, setRsDag] = useState("");
  const [lrDag, setLrDag] = useState("");
  const [rsKhatian, setRsKhatian] = useState("");
  const [lrKhatian, setLrKhatian] = useState("");
  const [area, setArea] = useState("");
  const [areaUnitId, setAreaUnitId] = useState("");
  const [sellerId, setSellerId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [consideration, setConsideration] = useState("");
  const [executiveId, setExecutiveId] = useState("");

  const { data: deeds = [], isLoading } = useQuery({
    queryKey: ["legal-deeds"],
    queryFn: getLegalDeeds,
  });

  const { data: deedTypes = [] } = useQuery({ queryKey: ["legal-lookup", "deed-type"], queryFn: () => getLegalLookup("deed-type") });
  const { data: offices = [] } = useQuery({ queryKey: ["legal-lookup", "registration-office"], queryFn: () => getLegalLookup("registration-office") });
  const { data: projects = [] } = useQuery({ queryKey: ["legal-lookup", "project"], queryFn: () => getLegalLookup("project") });
  const { data: mouzas = [] } = useQuery({ queryKey: ["legal-lookup", "mouza"], queryFn: () => getLegalLookup("mouza") });
  const { data: areaUnits = [] } = useQuery({ queryKey: ["legal-lookup", "area-unit"], queryFn: () => getLegalLookup("area-unit") });
  const { data: parties = [] } = useQuery({ queryKey: ["legal-lookup", "person"], queryFn: () => getLegalLookup("person") });
  const { data: users = [] } = useQuery({ queryKey: ["legal-lookup", "user"], queryFn: () => getLegalLookup("user") });

  const createMutation = useMutation({
    mutationFn: createLegalDeed,
    onSuccess: (data) => {
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ["legal-deeds"] });
      setOpenCreateModal(false);
      navigate(`/legal/deeds/${data.deedRecordId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!deedTypeId || !officeId) return toast.error("Please fill required fields");
    createMutation.mutate({
      DeedNo: deedNo || null,
      DeedYear: deedYear ? Number(deedYear) : null,
      DeedTypeId: Number(deedTypeId),
      OfficeId: Number(officeId),
      ProjectId: projectId ? Number(projectId) : null,
      MouzaId: mouzaId ? Number(mouzaId) : null,
      RsDag: rsDag || null,
      LrDag: lrDag || null,
      RsKhatian: rsKhatian || null,
      LrKhatian: lrKhatian || null,
      RsPlotNo: rsDag || null,
      RsKhatianNo: rsKhatian || null,
      PurchasedArea: area ? Number(area) : null,
      AreaUnitId: areaUnitId ? Number(areaUnitId) : null,
      SellerPartyId: sellerId ? Number(sellerId) : null,
      BuyerPartyId: buyerId ? Number(buyerId) : null,
      ConsiderationAmount: consideration ? Number(consideration) : null,
      AssignedExecutiveId: executiveId ? Number(executiveId) : null,
      PlotDescription: `RS Dag: ${rsDag || "-"}, LR Dag: ${lrDag || "-"}, RS Khatian: ${rsKhatian || "-"}, LR Khatian: ${lrKhatian || "-"}`,
    });
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Deed Registrations" }]} />
      <LegalShell
        title="Land Deed Registration Tracker"
        subtitle="Manage land purchase deeds, document checklists, and two-level approval lifecycle."
        icon={DocumentUpload}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-heading font-semibold text-foreground">Registered & In-Progress Deeds</h2>
              <p className="text-xs text-muted-foreground">
                Track full evidence dossier, statutory fees, and approval chain before closing acquisition records.
              </p>
            </div>
            {rights.canCreate && (
              <Button onClick={() => setOpenCreateModal((v) => !v)} className="gap-2 bg-foreground text-card hover:bg-foreground/85">
                {openCreateModal ? <><X size={16} /> Close</> : <><Plus size={16} /> New Deed Registration</>}
              </Button>
            )}
          </div>

          <div className="order-2 rounded-xl border border-border/80 bg-card overflow-hidden shadow-sm">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading deeds…</div>
            ) : deeds.length === 0 ? (
              <div className="p-12 text-center">
                <DocumentUpload className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
                <h3 className="text-base font-semibold text-foreground">No deed registrations started</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Click "New Deed Registration" or launch a search from the Registration Search tab.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 border-b border-border/60 text-[0.6875rem] font-heading uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">File / Deed No.</th>
                      <th className="px-4 py-3">Type & Project</th>
                      <th className="px-4 py-3">Registration Office</th>
                      <th className="px-4 py-3">RS & LR Dags</th>
                      <th className="px-4 py-3">RS & LR Khatians</th>
                      <th className="px-4 py-3">Parties</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Docs Check</th>
                      <th className="px-4 py-3 text-right">View</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {deeds.map((d) => (
                      <tr
                        key={d.DeedRecordId}
                        onClick={() => navigate(`/legal/deeds/${d.DeedRecordId}`)}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="font-semibold text-foreground block">{d.DeedFileNo}</span>
                          <span className="text-xs font-mono text-muted-foreground">{d.DeedNo || "Awaiting Deed"}</span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="font-medium text-foreground block">{d.DeedTypeName}</span>
                          <span className="text-muted-foreground">{d.ProjectName || "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-foreground">{d.OfficeName}</td>
                        <td className="px-4 py-3 text-xs">
                          <div className="text-primary font-medium">RS: {d.RsDag || d.RsPlotNo || "—"}</div>
                          <div className="text-blue-600 dark:text-blue-400 font-medium">
                            LR: {d.LrDag || d.RsDag || d.RsPlotNo || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="text-primary font-medium">RS: {d.RsKhatian || d.RsKhatianNo || "—"}</div>
                          <div className="text-blue-600 dark:text-blue-400 font-medium">
                            LR: {d.LrKhatian || "—"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {d.SellerName && <div className="truncate max-w-[120px]"><span className="text-muted-foreground">S:</span> {d.SellerName}</div>}
                          {d.BuyerName && <div className="truncate max-w-[120px]"><span className="text-muted-foreground">B:</span> {d.BuyerName}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              d.OverallStatus === "Completed"
                                ? "bg-emerald-500/10 text-emerald-600"
                                : d.OverallStatus.includes("Returned")
                                ? "bg-amber-500/10 text-amber-600"
                                : d.OverallStatus.includes("Pending")
                                ? "bg-blue-500/10 text-blue-600"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {d.OverallStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="font-medium text-foreground">{d.AcceptedDocs} / {d.TotalDocs}</span>
                          {d.PendingMandatoryDocs > 0 && (
                            <span className="block text-[0.625rem] text-red-600 font-semibold">
                              {d.PendingMandatoryDocs} mandatory missing
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight size={16} className="text-muted-foreground inline" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        {/* New deed file — opens in the page above the list, closes on create or cancel */}
        {openCreateModal && (
          <div className="order-1 border border-border bg-card p-4 sm:p-5">
            <h2 className="text-base font-heading font-semibold text-foreground">Open New Deed Registration Dossier</h2>
            <form onSubmit={handleCreateSubmit} className="space-y-4 py-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold">Deed Type *</Label>
                  <select
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={deedTypeId}
                    onChange={(e) => setDeedTypeId(e.target.value)}
                    required
                  >
                    <option value="">Select Deed Type</option>
                    {deedTypes.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs font-semibold">Registration Office *</Label>
                  <select
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={officeId}
                    onChange={(e) => setOfficeId(e.target.value)}
                    required
                  >
                    <option value="">Select Office</option>
                    {offices.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs font-semibold">Registered Deed No.</Label>
                  <Input
                    value={deedNo}
                    onChange={(e) => setDeedNo(e.target.value)}
                    placeholder="e.g. I-04128/2026"
                    className="mt-1 text-sm font-semibold"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Registration Year</Label>
                  <Input
                    type="number"
                    value={deedYear}
                    onChange={(e) => setDeedYear(e.target.value)}
                    className="mt-1 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Project / Enterprise</Label>
                  <select
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">Select Project</option>
                    {projects.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Distinct Land Identifiers Box */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    West Bengal Land Parcel Identifiers
                  </span>
                  <span className="text-[0.6875rem] text-primary font-medium">Distinct RS & LR Fields</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-[0.6875rem]">Mouza</Label>
                    <select
                      className="w-full mt-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
                      value={mouzaId}
                      onChange={(e) => setMouzaId(e.target.value)}
                    >
                      <option value="">Select Mouza</option>
                      {mouzas.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <Label className="text-[0.6875rem] font-semibold text-primary">RS Dag (Plot)</Label>
                    <Input
                      value={rsDag}
                      onChange={(e) => setRsDag(e.target.value)}
                      placeholder="e.g. 412"
                      className="mt-1 h-8 text-xs bg-background"
                    />
                  </div>

                  <div>
                    <Label className="text-[0.6875rem] font-semibold text-blue-600 dark:text-blue-400">
                      LR Dag (Plot)
                    </Label>
                    <Input
                      value={lrDag}
                      onChange={(e) => setLrDag(e.target.value)}
                      placeholder="e.g. 412"
                      className="mt-1 h-8 text-xs bg-background"
                    />
                  </div>

                  <div>
                    <Label className="text-[0.6875rem] font-semibold text-primary">RS Khatian</Label>
                    <Input
                      value={rsKhatian}
                      onChange={(e) => setRsKhatian(e.target.value)}
                      placeholder="e.g. 245"
                      className="mt-1 h-8 text-xs bg-background"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <Label className="text-[0.6875rem] font-semibold text-blue-600 dark:text-blue-400">
                      LR Khatian
                    </Label>
                    <Input
                      value={lrKhatian}
                      onChange={(e) => setLrKhatian(e.target.value)}
                      placeholder="e.g. 520"
                      className="mt-1 h-8 text-xs bg-background"
                    />
                  </div>
                  <div>
                    <Label className="text-[0.6875rem]">Assigned Executive</Label>
                    <select
                      className="w-full mt-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
                      value={executiveId}
                      onChange={(e) => setExecutiveId(e.target.value)}
                    >
                      <option value="">Select Executive</option>
                      {users.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Purchased Area</Label>
                  <Input type="number" step="0.0001" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. 18.5" className="mt-1 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Area Unit</Label>
                  <select
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={areaUnitId}
                    onChange={(e) => setAreaUnitId(e.target.value)}
                  >
                    <option value="">Select Unit</option>
                    {areaUnits.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Seller (Vendor / Landholder)</Label>
                  <select
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={sellerId}
                    onChange={(e) => setSellerId(e.target.value)}
                  >
                    <option value="">Select Seller</option>
                    {parties.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Buyer (Company / Entity)</Label>
                  <select
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={buyerId}
                    onChange={(e) => setBuyerId(e.target.value)}
                  >
                    <option value="">Select Buyer</option>
                    {parties.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label className="text-xs">Consideration Amount (₹)</Label>
                <Input
                  type="number"
                  step="1"
                  value={consideration}
                  onChange={(e) => setConsideration(e.target.value)}
                  placeholder="Total Transaction Value"
                  className="mt-1 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpenCreateModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending} className="bg-foreground text-card hover:bg-foreground/85 font-semibold">
                  {createMutation.isPending ? "Creating…" : "Create Deed Dossier"}
                </Button>
              </div>
            </form>
          </div>
        )}
        </div>
      </LegalShell>
    </>
  );
}
