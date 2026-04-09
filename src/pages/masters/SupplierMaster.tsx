import React from "react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { MasterPage, type DataChangeEvent } from "@/components/MasterPage"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getEnterprises, addEnterprise, updateEnterprise, deleteEnterprise } from "@/api/enterpriseApi"
import { toast } from "sonner"

const fields = [
  { name: "name", label: "Supplier Name", type: "text", required: true },
  { name: "contact", label: "Contact Person", type: "text" },
  { name: "phone", label: "Phone Number", type: "text" },
  { name: "email", label: "Email Address", type: "text" },
  { name: "gst", label: "GST Number", type: "text", uppercase: true },
  { name: "pan", label: "PAN Number", type: "text", uppercase: true },
  { name: "category", label: "Supplier Category", type: "select", options: ["Material", "Equipment", "Labour", "Services", "Transport"] },
  { name: "paymentTerms", label: "Payment Terms", type: "select", options: ["Advance", "15 Days", "30 Days", "45 Days", "60 Days"] },
  { name: "creditLimit", label: "Credit Limit (₹)", type: "number", prefix: "₹" },
  { name: "address", label: "Address", type: "textarea", fullWidth: true },
  { name: "status", label: "Status", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "name", label: "Supplier Name" },
  { key: "contact", label: "Contact Person" },
  { key: "phone", label: "Phone" },
  { key: "gst", label: "GST No." },
  { key: "category", label: "Category" },
  { key: "paymentTerms", label: "Payment Terms" },
  { key: "status", label: "Status" },
];

const toPayload = (r: Record<string, unknown>) => ({
  name: r.name as string,
  business_type: (r.category as string) || "Supplier",
  pan: (r.pan as string) || null,
  address: (r.address as string) || null,
  email: (r.email as string) || null,
  phone_number: (r.phone as string) || null,
  status: r.status === true ? "Active" : "Inactive",
  tds_limit: r.creditLimit ? Number(r.creditLimit) : null,
  description: `Supplier: ${r.contact || ""}, GST: ${r.gst || ""}, Terms: ${r.paymentTerms || ""}, Limit: ${r.creditLimit || 0}`,
});

const SupplierMaster = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["suppliers"],
    queryFn: getEnterprises,
  })

  const dbItems = Array.isArray(dbData) ? dbData : []

  const supplierData = dbItems
    .filter(item => 
      item.name?.toLowerCase().includes("hardware") ||
      item.name?.toLowerCase().includes("material") ||
      item.name?.toLowerCase().includes("steel") ||
      item.name?.toLowerCase().includes("transport") ||
      item.business_type?.toLowerCase().includes("supplier")
    )
    .map(item => ({
      _id: String(item.id),
      name: item.name || "",
      contact: item.contact || "",
      phone: item.phone_number || "",
      email: item.email || "",
      gst: item.gst || "",
      pan: item.pan || "",
      category: item.business_type || "Material",
      paymentTerms: item.payment_terms || "30 Days",
      creditLimit: item.tds_limit || 0,
      address: item.address || "",
      status: item.status !== "Inactive",
    }))

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addEnterprise(toPayload(event.record))
        toast.success("Supplier saved!")
      } else if (event.action === "update") {
        await updateEnterprise(event.id, toPayload(event.record))
        toast.success("Supplier updated!")
      } else if (event.action === "delete") {
        await deleteEnterprise(event.id)
        toast.success("Supplier deleted!")
      }
      await queryClient.invalidateQueries({ queryKey: ["suppliers", "enterprises"] })
    } catch (err: any) {
      toast.error(err.message || "Operation failed")
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading suppliers...</div>
  if (error) return <div className="p-6 text-destructive">Failed to load suppliers.</div>

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Supplier Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Supplier Master</h1>
      <MasterPage 
        title="Supplier" 
        fields={fields} 
        columns={columns} 
        initialData={supplierData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default SupplierMaster

