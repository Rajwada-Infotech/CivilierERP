import React from "react"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { MasterPage, type DataChangeEvent } from "@/components/MasterPage"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  getItemGroups,
  addItemGroup,
  updateItemGroup,
  deleteItemGroup,
} from "@/api/itemGroupApi"
import { toast } from "sonner"

interface DbItemGroup {
  M_Id: string
  M_Name: string
  M_Description: string | null
  M_Type: string | null
  M_Group: string | null
  M_IdentityCode: boolean | null
  M_HSN: string | null
  M_CGST: number | null
  M_IGST: number | null
  M_SGST: number | null
  Parent_Id: string | null
}

const toPayload = (record: Record<string, unknown>) => ({
  M_Name: record.description as string,
  M_Description: record.description as string,
  M_IdentityCode: false,
  M_Type: (record.shortCode as string) || null,
  M_HSN: null,
  M_CGST: null,
  M_IGST: null,
  M_SGST: null,
  M_BelongsTo: null,
  M_Group: (record.code as string) || null,
  M_CreatedBy: 1,
  M_ApprovedBy: null,
  Parent_Id: null,
})

const ItemGroupMaster: React.FC = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["item-groups"],
    queryFn: getItemGroups,
  })

  const dbItems: DbItemGroup[] = Array.isArray(dbData) ? dbData : []

  const mappedData = dbItems.map(item => ({
    _id: String(item.M_Id),
    description: item.M_Name || "",
    code: item.M_Group || "",
    shortCode: item.M_Type || "",
  }))

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addItemGroup(toPayload(event.record))
        toast.success("Item group saved!")
        await queryClient.invalidateQueries({ queryKey: ["item-groups"] })
      } catch (err: any) {
        toast.error("Save failed: " + err.message)
      }
    }

    if (event.action === "update") {
      try {
        await updateItemGroup(event.id, toPayload(event.record))
        toast.success("Item group updated!")
        await queryClient.invalidateQueries({ queryKey: ["item-groups"] })
      } catch (err: any) {
        toast.error("Update failed: " + err.message)
      }
    }

    if (event.action === "delete") {
      try {
        await deleteItemGroup(event.id)
        toast.success("Item group deleted!")
        await queryClient.invalidateQueries({ queryKey: ["item-groups"] })
      } catch (err: any) {
        toast.error("Delete failed: " + err.message)
      }
    }
  }

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>

  if (error)
    return (
      <div className="p-6 text-red-500">
        Failed to load item groups. Check your backend connection.
      </div>
    )

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Item Group Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Item Group Master
      </h1>
      <MasterPage
        title="Item Group"
        fields={[
          { name: "description", label: "Description", type: "text", required: true },
          { name: "code", label: "Code", type: "text", required: true, uppercase: true },
          { name: "shortCode", label: "Short Code", type: "text", required: true, uppercase: true },
        ]}
        columns={[
          { key: "description", label: "Description" },
          { key: "code", label: "Code" },
          { key: "shortCode", label: "Short Code" },
        ]}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default ItemGroupMaster