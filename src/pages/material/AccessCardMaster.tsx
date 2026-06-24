import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaterialShell } from "@/components/material/MaterialShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  CalendarRange,
  FileBadge2,
  ShieldCheck,
} from "lucide-react";
import {
  getCards as getCardMasters,
  addCard as addCardMaster,
  updateCard as updateCardMaster,
  deleteCard as deleteCardMaster,
} from "@/api/cardMasterApi";

const fields: FieldDef[] = [
  { name: "cardNumber", label: "Card No.", type: "text", required: true },
  {
    name: "cardType",
    label: "Card Type",
    type: "select",
    options: [
      "Access",
      "Security",
      "Identity",
      "Contractor",
      "Visitor",
      "Other",
    ],
  },
  { name: "holderName", label: "Holder Name", type: "text" },
  { name: "issuedFor", label: "Issued For", type: "text" },
  { name: "vendorContractor", label: "Vendor / Contractor", type: "text" },
  { name: "siteProject", label: "Site / Project", type: "text" },
  { name: "materialCategory", label: "Material Category", type: "text" },
  { name: "validity", label: "Validity", type: "date" },
  {
    name: "accessLevel",
    label: "Access Level",
    type: "select",
    options: ["Full", "Restricted", "Temporary", "Read-Only"],
  },
  { name: "remarks", label: "Remarks", type: "textarea" },
  { name: "status", label: "Active", type: "toggle" },
];

const columns = [
  { key: "holderName", label: "Holder" },
  { key: "cardType", label: "Card Type", hideOnMobile: true },
  { key: "siteProject", label: "Site / Project", hideOnMobile: true },
  { key: "accessLevel", label: "Access", hideOnMobile: true },
  { key: "validity", label: "Validity", hideOnMobile: true },
  { key: "status", label: "Status" },
];

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Card No.", accessor: "cardNumber" },
  { header: "Holder", accessor: "holderName" },
  { header: "Card Type", accessor: "cardType" },
  { header: "Site / Project", accessor: "siteProject" },
  { header: "Access Level", accessor: "accessLevel" },
  { header: "Validity", accessor: "validity" },
  { header: "Status", accessor: "status" },
];

const AccessCardMaster = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["card-masters"],
    queryFn: getCardMasters,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems = Array.isArray(dbData) ? dbData : [];

  // DbCard uses snake_case columns. This page repurposes the bank-card table for
  // access/identity card tracking, mapping fields as follows:
  //   card_number        → cardNumber   (Card No. — same intent)
  //   card_type          → cardType     (Access / Security / Visitor etc.)
  //   card_holder_name   → holderName   (Person the card is issued to)
  //   ifsc_code          → issuedFor    (Purpose / department — free text)
  //   bank_name          → vendorContractor  (Vendor or contractor name)
  //   company_name       → siteProject  (Site or project name)
  //   account_number     → materialCategory (Material category — free text)
  //   card_network       → accessLevel  (Full / Restricted / Temporary)
  //   cvv                → remarks      (Free-text remarks, stored in cvv col)
  //   expiry_* / reminder → unused, null
  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: String(item.id),
    cardNumber: item.card_number ?? "",
    cardType: item.card_type ?? "",
    holderName: item.card_holder_name ?? "",
    issuedFor: item.ifsc_code ?? "",
    vendorContractor: item.bank_name ?? "",
    siteProject: item.company_name ?? "",
    materialCategory: item.account_number ?? "",
    validity: item.card_network ?? "", // re-mapped: access level stored here temporarily
    accessLevel: item.card_network ?? "",
    remarks: item.cvv ?? "",
    status: item.status !== false,
  }));

  const toPayload = (r: Record<string, unknown>) => ({
    card_number: (r.cardNumber as string) || null,
    card_type: (r.cardType as string) || null,
    card_holder_name: (r.holderName as string) || null,
    ifsc_code: (r.issuedFor as string) || null,
    bank_name: (r.vendorContractor as string) || null,
    company_name: (r.siteProject as string) || null,
    account_number: (r.materialCategory as string) || null,
    card_network: (r.accessLevel as string) || null,
    cvv: (r.remarks as string) || null,
    expiry_month: null,
    expiry_year: null,
    reminder_enabled: false,
    reminder_days: null,
    status: r.status !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addCardMaster(toPayload(event.record));
        toast.success("Card saved!");
        await queryClient.invalidateQueries({ queryKey: ["card-masters"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateCardMaster(event.id, toPayload(event.record));
        toast.success("Card updated!");
        await queryClient.invalidateQueries({ queryKey: ["card-masters"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteCardMaster(event.id);
        toast.success("Card deleted!");
        await queryClient.invalidateQueries({ queryKey: ["card-masters"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers = {
    cardNumber: (value: unknown) => (
      <div className="flex items-center gap-2 min-w-[140px]">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <FileBadge2 size={15} />
        </span>
        <span className="font-heading font-semibold text-foreground">
          {String(value ?? "")}
        </span>
      </div>
    ),
    cardType: (value: unknown) => (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-heading text-foreground">
        <BadgeCheck size={11} className="text-emerald-600 dark:text-emerald-400" />
        {String(value ?? "")}
      </span>
    ),
    accessLevel: (value: unknown) => (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-heading text-emerald-600 dark:text-emerald-400">
        <ShieldCheck size={11} />
        {String(value ?? "")}
      </span>
    ),
    validity: (value: unknown, row: RecordWithId) => (
      <div className="flex flex-col">
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <CalendarRange size={13} className="text-muted-foreground" />
          {String(value ?? "")}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {String(row.materialCategory ?? "")}
        </span>
      </div>
    ),
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading cards...</div>;
  if (error)
    return <div className="p-6 text-destructive">Failed to load cards.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material", "Access Card Master"]} />
      <MaterialShell
        title="Access Card Master"
        subtitle="Manage and track access cards"
        icon={BadgeCheck}
      >
      <MasterPage
        title="Card"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        exportConfig={{
          title: "Access Cards",
          columns: EXPORT_COLUMNS,
          filename: "access-card-master",
        }}
      />
      </MaterialShell>
    </>
  );
};

export default AccessCardMaster;
