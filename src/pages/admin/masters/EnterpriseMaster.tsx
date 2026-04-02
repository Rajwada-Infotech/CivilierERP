import React from "react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { MasterPage, type DataChangeEvent } from "@/components/MasterPage"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getEnterprises, addEnterprise, updateEnterprise, deleteEnterprise } from "@/api/enterpriseApi"
import { toast } from "sonner"

interface DbEnterprise {
  id: number
  name: string | null
  business_identity: string | null
  business_type: string | null
  b_sub_identity_type: string | null
  belongs_to: number | null
  logo: string | null
  date_of_entry: string | null
  date_of_establishment: string | null
  currency: string | null
  pan: string | null
  cin: string | null
  address: string | null
  email: string | null
  phone_number: string | null
  tds_limit: number | null
  description: string | null
  gst_type: string | null
  status: string | null
  cr_code: string | null
  discontinue: boolean | null
}

const toPayload = (r: Record<string, unknown>) => ({
  name: r.name as string,
  business_identity: (r.business_identity as string) || null,
  business_type: (r.business_type as string) || null,
  b_sub_identity_type: (r.b_sub_identity_type as string) || null,
  belongs_to: r.belongs_to ? Number(r.belongs_to) : null,
  logo: (r.logo as string) || null,
  date_of_entry: (r.date_of_entry as string) || null,
  date_of_establishment: (r.date_of_establishment as string) || null,
  currency: (r.currency as string) || null,
  pan: (r.pan as string) || null,
  cin: (r.cin as string) || null,
  address: (r.address as string) || null,
  email: (r.email as string) || null,
  phone_number: (r.phone_number as string) || null,
  tds_limit: r.tds_limit ? Number(r.tds_limit) : null,
  description: (r.description as string) || null,
  gst_type: (r.gst_type as string) || null,
  status: (r.status as string) || null,
  cr_code: (r.cr_code as string) || null,
  discontinue: r.discontinue === true,
})

const EnterpriseMaster: React.FC = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["enterprises"],
    queryFn: getEnterprises,
  })

  const dbItems: DbEnterprise[] = Array.isArray(dbData) ? dbData : []

  const mappedData = dbItems.map(item => ({
    _id: String(item.id),
    name: item.name || "",
    business_identity: item.business_identity || "",
    business_type: item.business_type || "",
    b_sub_identity_type: item.b_sub_identity_type || "",
    belongs_to: item.belongs_to ?? "",
    date_of_entry: item.date_of_entry?.slice(0, 10) || "",
    date_of_establishment: item.date_of_establishment?.slice(0, 10) || "",
    currency: item.currency || "",
    pan: item.pan || "",
    cin: item.cin || "",
    address: item.address || "",
    email: item.email || "",
    phone_number: item.phone_number || "",
    tds_limit: item.tds_limit ?? "",
    description: item.description || "",
    gst_type: item.gst_type || "",
    status: item.status || "",
    cr_code: item.cr_code || "",
    discontinue: item.discontinue ?? false,
  }))

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addEnterprise(toPayload(event.record))
        toast.success("Enterprise saved!")
        await queryClient.invalidateQueries({ queryKey: ["enterprises"] })
      } catch (err: any) {
        toast.error("Save failed: " + err.message)
      }
    }
    if (event.action === "update") {
      try {
        await updateEnterprise(event.id, toPayload(event.record))
        toast.success("Enterprise updated!")
        await queryClient.invalidateQueries({ queryKey: ["enterprises"] })
      } catch (err: any) {
        toast.error("Update failed: " + err.message)
      }
    }
    if (event.action === "delete") {
      try {
        await deleteEnterprise(event.id)
        toast.success("Enterprise deleted!")
        await queryClient.invalidateQueries({ queryKey: ["enterprises"] })
      } catch (err: any) {
        toast.error("Delete failed: " + err.message)
      }
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>
  if (error) return <div className="p-6 text-red-500">Failed to load enterprises.</div>

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Masters", "Enterprise Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Enterprise Master</h1>
      <MasterPage
        title="Enterprise"
        fields={[
          { name: "name",                 label: "Name",                  type: "text",     required: true },
          { name: "business_identity",    label: "Business Identity",     type: "text" },
          { name: "business_type",        label: "Business Type",         type: "select",   options: ["Proprietorship", "Partnership", "LLP", "Pvt Ltd", "Ltd", "Trust", "Society", "Other"] },
          { name: "b_sub_identity_type",  label: "Sub Identity Type",     type: "text" },
          { name: "gst_type",             label: "GST Type",              type: "select",   options: ["Regular", "Composition", "Unregistered", "SEZ", "Deemed Export"] },
          { name: "status",               label: "Status",                type: "select",   options: ["Active", "Inactive", "Suspended"] },
          { name: "pan",                  label: "PAN",                   type: "text",     uppercase: true },
          { name: "cin",                  label: "CIN",                   type: "text",     uppercase: true },
          { name: "cr_code",              label: "CR Code",               type: "text" },
          { name: "currency",             label: "Currency",              type: "select",   options: ["INR", "USD", "EUR", "GBP", "AED"] },
          { name: "tds_limit",            label: "TDS Limit",             type: "number" },
          { name: "phone_number",         label: "Phone Number",          type: "text" },
          { name: "email",                label: "Email",                 type: "text" },
          { name: "date_of_entry",        label: "Date of Entry",         type: "text" },
          { name: "date_of_establishment",label: "Date of Establishment", type: "text" },
          { name: "address",              label: "Address",               type: "textarea", fullWidth: true },
          { name: "description",          label: "Description",           type: "textarea", fullWidth: true },
          { name: "discontinue",          label: "Discontinued",          type: "toggle",   defaultValue: false },
        ]}
        columns={[
          { key: "name",             label: "Name" },
          { key: "business_type",    label: "Type",        hideOnMobile: true },
          { key: "pan",              label: "PAN",         hideOnMobile: true },
          { key: "gst_type",         label: "GST Type",    hideOnMobile: true },
          { key: "phone_number",     label: "Phone" },
          { key: "status",           label: "Status" },
        ]}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default EnterpriseMaster