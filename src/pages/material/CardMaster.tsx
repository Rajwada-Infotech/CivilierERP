import React from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MasterPage, type DataChangeEvent, type RecordWithId } from '@/components/MasterPage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BadgeCheck, CalendarRange, FileBadge2, ShieldCheck } from "lucide-react"
import {
  getCardMasters,
  addCardMaster,
  updateCardMaster,
  deleteCardMaster,
} from '@/api/cardMasterApi'



const columns = [
  { key: 'cardNumber', label: 'Card No.' },
  { key: 'holderName', label: 'Holder' },
  { key: 'cardType', label: 'Card Type', hideOnMobile: true },
  { key: 'siteProject', label: 'Site / Project', hideOnMobile: true },
  { key: 'accessLevel', label: 'Access', hideOnMobile: true },
  { key: 'validity', label: 'Validity', hideOnMobile: true },
  { key: 'status', label: 'Status' },
];



const CardMaster = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ['card-masters'],
    queryFn: getCardMasters,
    staleTime: 5 * 60 * 1000,
  })

  const dbItems = Array.isArray(dbData) ? dbData : []

  const mappedData: RecordWithId[] = dbItems.map(item => ({
    _id: String(item.CardId || item.id || item._id),
    cardNumber: item.CardNumber || item.cardNumber || '',
    cardType: item.CardType || item.cardType || '',
    holderName: item.HolderName || item.holderName || '',
    issuedFor: item.IssuedFor || item.issuedFor || '',
    vendorContractor: item.VendorContractor || item.vendorContractor || '',
    siteProject: item.SiteProject || item.siteProject || '',
    materialCategory: item.MaterialCategory || item.materialCategory || '',
    validity: item.Validity || item.validity || '',
    accessLevel: item.AccessLevel || item.accessLevel || '',
    remarks: item.Remarks || item.remarks || '',
    status: item.Status !== false,
  }))

  const toPayload = (r: Record<string, unknown>) => ({
    CardNumber: (r.cardNumber as string) || null,
    CardType: (r.cardType as string) || null,
    HolderName: (r.holderName as string) || null,
    IssuedFor: (r.issuedFor as string) || null,
    VendorContractor: (r.vendorContractor as string) || null,
    SiteProject: (r.siteProject as string) || null,
    MaterialCategory: (r.materialCategory as string) || null,
    Validity: (r.validity as string) || null,
    AccessLevel: (r.accessLevel as string) || null,
    Remarks: (r.remarks as string) || null,
    Status: r.status !== false,
  })

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === 'add') {
      try {
        await addCardMaster(toPayload(event.record))
        toast.success('Card saved!')
        await queryClient.invalidateQueries({ queryKey: ['card-masters'] })
      } catch (err: any) { toast.error('Save failed: ' + err.message) }
    }
    if (event.action === 'update') {
      try {
        await updateCardMaster(event.id, toPayload(event.record))
        toast.success('Card updated!')
        await queryClient.invalidateQueries({ queryKey: ['card-masters'] })
      } catch (err: any) { toast.error('Update failed: ' + err.message) }
    }
    if (event.action === 'delete') {
      try {
        await deleteCardMaster(event.id)
        toast.success('Card deleted!')
        await queryClient.invalidateQueries({ queryKey: ['card-masters'] })
      } catch (err: any) { toast.error('Delete failed: ' + err.message) }
    }
  }

  const columnRenderers = {
    cardNumber: (value: unknown) => (
      <div className="flex items-center gap-2 min-w-[140px]">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileBadge2 size={15} />
        </span>
        <span className="font-heading font-semibold text-foreground">
          {String(value ?? "")}
        </span>
      </div>
    ),
    cardType: (value: unknown) => (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-heading text-foreground">
        <BadgeCheck size={11} className="text-primary" />
        {String(value ?? "")}
      </span>
    ),
    accessLevel: (value: unknown) => (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-heading text-primary">
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
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading cards...</div>
  if (error) return <div className="p-6 text-destructive">Failed to load cards.</div>

  return (
    <>
      <Breadcrumbs items={['Dashboard', 'Material Module', 'Card Master']} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Card Master</h1>
      <MasterPage
        title="Card"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default CardMaster
