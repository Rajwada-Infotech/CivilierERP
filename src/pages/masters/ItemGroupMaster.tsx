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
  M_code: string | null
  M_BelongsTo: string | null
  M_Group: string | null
  M_IdentityCode: boolean | null
  M_HSN: string | null
  M_CGST: number | null
  M_IGST: number | null
  M_SGST: number | null
  Parent_Id: string | null
}

// ✅ M_CreatedBy removed — backend reads it from JWT token via req.user.userId
const toPayload = (record: Record<string, unknown>) => ({
  M_Name:         record.Name as string,
  M_Description:  record.Description as string,
  M_code:         (record.Code as string) || null,
  M_Type:         null,
  M_IdentityCode: false,
  M_HSN:          null,
  M_CGST:         null,
  M_IGST:         null,
  M_SGST:         null,
  // ✅ M_BelongsTo = Item Group Name (M_Name of this group itself)
  M_BelongsTo:    null,
  // ✅ M_Group stays null as per your requirement
  M_Group:        null,
  M_ApprovedBy:   null,
  Parent_Id:      null,
})

const ItemGroupMaster: React.FC = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["item-groups"],
    queryFn: getItemGroups,
  })

  const dbItems: DbItemGroup[] = Array.isArray(dbData) ? dbData : []

  const mappedData = dbItems.map(item => ({
    _id:         String(item.M_Id),
    Name:        item.M_Name        || "",
    Description: item.M_Description || "",
    Code:        item.M_code        || "",
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
          { name: "Name",        label: "Name",        type: "text", required: true },
          { name: "Code",        label: "Code",        type: "text", required: true, uppercase: true },
          { name: "Description", label: "Description", type: "text", required: true },
        ]}
        columns={[
          { key: "Name",        label: "Name" },
          { key: "Code",        label: "Code" },
          { key: "Description", label: "Description" },
        ]}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default ItemGroupMaster