import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { SheetMark } from "@/components/sheet/Sheet";
import { MasterPage, type DataChangeEvent, type RecordWithId } from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getElectricityProviders,
  createElectricityProvider,
  updateElectricityProvider,
  type ElectricityProvider,
} from "@/api/electricityMaintenanceApi";

const toPayload = (r: Record<string, unknown>) => ({
  name: (r.name as string) || "",
  code: (r.code as string) || undefined,
  state: (r.state as string) || undefined,
  billingMethod: (r.billingMethod as string) || undefined,
  status: r.status === false ? "Inactive" : "Active",
  remarks: (r.remarks as string) || undefined,
});

const ElectricityProviderMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("electricity-provider-master");

  const { data, isLoading, error } = useQuery({
    queryKey: ["electricity-providers"],
    queryFn: getElectricityProviders,
    staleTime: 5 * 60 * 1000,
  });

  const rows: ElectricityProvider[] = Array.isArray(data) ? data : [];
  const mappedData: RecordWithId[] = rows.map((p) => ({
    _id: String(p.Id),
    name: p.Name,
    code: p.Code || "",
    state: p.State || "",
    billingMethod: p.BillingMethod || "",
    status: p.Status === "Active",
    remarks: p.Remarks || "",
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      await createElectricityProvider(toPayload(event.record));
      toast.success("Provider added");
      await queryClient.invalidateQueries({ queryKey: ["electricity-providers"] });
    }
    if (event.action === "update") {
      await updateElectricityProvider(Number(event.id), toPayload(event.record));
      toast.success("Provider updated");
      await queryClient.invalidateQueries({ queryKey: ["electricity-providers"] });
    }
  };

  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => (
      <SheetMark text={value ? "Active" : "Inactive"} tone={value ? "done" : "draft"} />
    ),
  };

  if (isLoading) return <div className="skel m-6" style={{ height: 240 }} />;
  if (error) return <div className="m-6 border border-destructive bg-destructive/5 p-6 text-sm text-destructive">Failed to load Electricity Providers.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Electricity Provider Master"]} />
      <MaintenanceShell title="Electricity Provider Master" subtitle="Discoms serving your projects — never hard-coded" icon={Zap}>
        <MasterPage
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          title="Electricity Provider"
          fields={[
            { name: "name", label: "Provider Name", type: "text", required: true, placeholder: "e.g. CESC" },
            { name: "code", label: "Short Code", type: "text", uppercase: true },
            { name: "state", label: "State", type: "text" },
            { name: "billingMethod", label: "Billing Method", type: "text", placeholder: "e.g. Slab-wise" },
            { name: "remarks", label: "Remarks", type: "textarea", fullWidth: true },
            { name: "status", label: "Status", type: "toggle", defaultValue: true },
          ]}
          columns={[
            { key: "name", label: "Provider" },
            { key: "code", label: "Code", hideOnMobile: true },
            { key: "state", label: "State", hideOnMobile: true },
            { key: "billingMethod", label: "Billing Method", hideOnMobile: true },
            { key: "status", label: "Status" },
          ]}
          columnRenderers={columnRenderers}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          canDelete={false}
          exportConfig={rights.canExport ? {
            title: "Electricity Provider Master",
            filename: "electricity-provider-master",
            columns: [
              { header: "Provider", accessor: "name" },
              { header: "Code", accessor: "code" },
              { header: "State", accessor: "state" },
              { header: "Billing Method", accessor: "billingMethod" },
              { header: "Status", accessor: "status" },
            ],
          } : undefined}
        />
      </MaintenanceShell>
    </>
  );
};

export default ElectricityProviderMaster;
