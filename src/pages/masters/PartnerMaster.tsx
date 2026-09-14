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
    belongsToCode: p.belongsToCode || "",
    belongsToName: p.belongsToName || "—",
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    // No try/catch here — a rejected addPartner/updatePartner/deletePartner
    // must propagate up to MasterPage's own handleSave/handleDelete, which
    // is what decides whether to show a success toast and commit the row
    // to local state. Swallowing the error here (and showing our own toast)
    // used to leave MasterPage none the wiser: it saw onDataEvent resolve
    // normally, so it showed ITS OWN "Record saved successfully" toast and
    // added a phantom row to the table even though nothing was persisted —
    // exactly what made a genuinely failed save (e.g. missing CAPA0/CURAC
    // account groups) look like it had worked.
    if (event.action === "add") {
      await addPartner({
        PartnerName: (event.record.partnerName as string) || "",
        PartnerCode: (event.record.partnerCode as string) || "",
        BelongsTo: (event.record.belongsToCode as string) || undefined,
      });
      toast.success("Partner added — Capital and Current Account ledgers created");
      await queryClient.invalidateQueries({ queryKey: ["partner-master"] });
    }
    if (event.action === "update") {
      await updatePartner(event.id, {
        PartnerName: (event.record.partnerName as string) || "",
        Status: event.record.status !== false,
        // Always sent (even "") so clearing the field on an existing
        // Partner actually clears it — see partnerMaster.js's PUT route,
        // which treats a present-but-empty BelongsTo as "remove the
        // reference", not "leave it alone".
        BelongsTo: (event.record.belongsToCode as string) || "",
      });
      toast.success("Partner updated");
      await queryClient.invalidateQueries({ queryKey: ["partner-master"] });
    }
    if (event.action === "delete") {
      await deletePartner(event.id);
      toast.success("Partner deleted");
      await queryClient.invalidateQueries({ queryKey: ["partner-master"] });
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
            {
              name: "belongsToCode",
              label: "Belongs To (optional)",
              type: "select",
              // Note-only relationship to another existing Partner — e.g.
              // tagging "Misha Agarwal" as belonging to "Bikash Agarwal"
              // (spouse/family). No accounting effect, so it's excluded
              // from `required` and from every export/GL path. Excludes
              // the record being edited from its own option list — a
              // partner can't belong to themselves (also enforced
              // server-side either way).
              optionsProvider: (data, currentId) =>
                data
                  .filter((r) => r._id !== currentId)
                  .map((r) => ({
                    value: (r.partnerCode as string) || "",
                    label: (r.partnerName as string) || (r.partnerCode as string) || "",
                  })),
            },
            { name: "status", label: "Status", type: "toggle", defaultValue: true },
          ]}
          columns={[
            { key: "partnerName", label: "Partner Name" },
            { key: "partnerCode", label: "Partner Code" },
            { key: "belongsToName", label: "Belongs To", sortable: false },
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
              { header: "Belongs To", accessor: "belongsToName" },
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
