import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { MasterPage, type DataChangeEvent, type RecordWithId } from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Handshake } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getPartners,
  addPartner,
  updatePartner,
  deletePartner,
} from "@/api/partnerMasterApi";

const PartnerMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("partner-master");

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["partner-master"],
    queryFn: getPartners,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = (dbData ?? []).map((p) => ({
    _id: p.id,
    partnerName: p.partnerName || "",
    partnerCode: p.partnerCode || "",
    capitalGroupName: p.capitalGroupName || "—",
    currentGroupName: p.currentGroupName || "—",
    status: p.status,
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addPartner({
          PartnerName: (event.record.partnerName as string) || "",
          PartnerCode: (event.record.partnerCode as string) || "",
        });
        toast.success("Partner added — Capital and Current Account ledgers created");
        await queryClient.invalidateQueries({ queryKey: ["partner-master"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updatePartner(event.id, {
          PartnerName: (event.record.partnerName as string) || "",
          Status: event.record.status !== false,
        });
        toast.success("Partner updated");
        await queryClient.invalidateQueries({ queryKey: ["partner-master"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deletePartner(event.id);
        toast.success("Partner deleted");
        await queryClient.invalidateQueries({ queryKey: ["partner-master"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}>
        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value ? "bg-emerald-500" : "bg-red-500"}`} />
        {value ? "Active" : "Inactive"}
      </span>
    ),
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load Partner Master.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Partner Master"]} />
      <FinanceShell title="Partner Master" subtitle="Firm partners — a Capital and a Current Account ledger, created together" icon={Handshake}>
        <MasterPage
          title="Partner"
          fields={[
            { name: "partnerName", label: "Partner Name", type: "text", required: true, placeholder: "e.g. Rajesh Sharma" },
            {
              name: "partnerCode",
              label: "Partner Code",
              type: "text",
              required: true,
              uppercase: true,
              placeholder: "e.g. PTR-001",
            },
            { name: "status", label: "Status", type: "toggle", defaultValue: true },
          ]}
          columns={[
            { key: "partnerName", label: "Partner Name" },
            { key: "partnerCode", label: "Partner Code" },
            { key: "capitalGroupName", label: "Capital Ledger", sortable: false },
            { key: "currentGroupName", label: "Current Ledger", sortable: false },
            { key: "status", label: "Status" },
          ]}
          columnRenderers={columnRenderers}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          canDelete={rights.canDelete}
          exportConfig={rights.canExport ? {
            title: "Partner Master",
            filename: "partner-master",
            columns: [
              { header: "Partner Name", accessor: "partnerName" },
              { header: "Partner Code", accessor: "partnerCode" },
              { header: "Capital Ledger", accessor: "capitalGroupName" },
              { header: "Current Ledger", accessor: "currentGroupName" },
              { header: "Status", accessor: (r) => (r.status ? "Active" : "Inactive") },
            ],
          } : undefined}
        />
      </FinanceShell>
    </>
  );
};

export default PartnerMaster;
