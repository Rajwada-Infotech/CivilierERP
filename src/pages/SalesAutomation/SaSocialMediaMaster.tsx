import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/sa/social-media";

async function fetchPlatforms(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch social media platforms");
  return res.json().catch(() => ({}));
}

const fields: FieldDef[] = [
  { name: "name", label: "Platform Name", type: "text", required: true },
  {
    name: "platformType",
    label: "Platform Type",
    type: "select",
    options: ["Facebook", "Instagram", "Google", "LinkedIn", "YouTube", "WhatsApp", "SMS", "Email Marketing", "Other"],
  },
  { name: "accountDetails", label: "Account Details", type: "textarea", fullWidth: true },
  { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
  { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "name", label: "Platform Name" },
  { key: "platformType", label: "Type" },
  { key: "campaignCount", label: "Campaigns" },
  { key: "activeAdCount", label: "Active Ads" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Platform Name", accessor: "name" },
  { header: "Type", accessor: "platformType" },
  { header: "Campaigns", accessor: "campaignCount" },
  { header: "Active Ads", accessor: "activeAdCount" },
  { header: "Status", accessor: "isActive" },
];

const SaSocialMediaMaster: React.FC = () => {
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();

  const { data: platforms, isLoading, error } = useQuery({
    queryKey: ["sa-social-media"],
    queryFn: fetchPlatforms,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(platforms)) return [];
    return platforms.map((item) => ({
      _id: String(item.Id),
      name: item.Name ?? "",
      platformType: item.PlatformType ?? "",
      accountDetails: item.AccountDetails ?? "",
      notes: item.Notes ?? "",
      isActive: Boolean(item.IsActive),
      campaignCount: item.CampaignCount ?? 0,
      activeAdCount: item.ActiveAdCount ?? 0,
    }));
  }, [platforms]);

  const toPayload = (r: Record<string, any>) => ({
    Name: r.name?.trim() || null,
    PlatformType: r.platformType || null,
    AccountDetails: r.accountDetails || null,
    Notes: r.notes || null,
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add platform");
        toast.success("Platform added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update platform");
        toast.success("Platform updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete platform");
        toast.success("Platform deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["sa-social-media"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading platforms...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load platforms.</div>;

  return (
    <SalesAutoShell title="Social Media Master" subtitle="Manage social media platforms and their campaign connections">
      <div className="space-y-8">
        <MasterPage
          title="Social Media Platform"
          fields={fields}
          columns={columns}
          canCreate={canDoAction("sa-social-media", "create")}
          canEdit={canDoAction("sa-social-media", "edit")}
          canDelete={canDoAction("sa-social-media", "delete")}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Social Media Master",
            filename: "social-media-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Platform Details",
            fields: [
              { key: "name", label: "Platform Name" },
              { key: "platformType", label: "Type" },
              { key: "accountDetails", label: "Account Details" },
              { key: "notes", label: "Notes" },
              { key: "campaignCount", label: "Total Campaigns" },
              { key: "activeAdCount", label: "Active Ads" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaSocialMediaMaster;