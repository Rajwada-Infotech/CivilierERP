import React from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MasterPage, type DataChangeEvent, type RecordWithId } from '@/components/MasterPage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Calendar as CalendarIcon } from 'lucide-react'
 
// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = 'http://localhost:5000/api/fin-year'
 
const getFinYears   = () => fetch(BASE).then(r => r.json())
const addFinYear    = (data: object) => fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
const updateFinYear = (id: string, data: object) => fetch(`${BASE}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
const deleteFinYear = (id: string) => fetch(`${BASE}/${id}`, { method: 'DELETE' }).then(r => r.json())
 
// ─── Types ────────────────────────────────────────────────────────────────────
interface DbFinYear {
  FId: number
  FName: string | null
  FStartDate: string | null
  FEndDate: string | null
  FStatus: boolean
  FisLocked: boolean
}
 
// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  FName:      (r.year       as string) || null,
  FStartDate: (r.startDate  as string) || null,
  FEndDate:   (r.endDate    as string) || null,
  FStatus:    r.status !== false && r.status !== 'Closed',
  FisLocked:  r.locked === true || r.locked === 'true',
})
 
// ─── Component ────────────────────────────────────────────────────────────────
const FinancialYearMaster: React.FC = () => {
  const queryClient = useQueryClient()
 
  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ['fin-years'],
    queryFn: getFinYears,
  })
 
  const dbItems: DbFinYear[] = Array.isArray(dbData) ? dbData : []
 
  const mappedData: RecordWithId[] = dbItems.map(item => ({
    _id:       String(item.FId),
    year:      item.FName      || '',
    startDate: item.FStartDate ? item.FStartDate.split('T')[0] : '',
    endDate:   item.FEndDate   ? item.FEndDate.split('T')[0]   : '',
    status:    item.FStatus ? 'Active' : 'Closed',
    locked:    item.FisLocked,
  }))
 
  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === 'add') {
      try {
        await addFinYear(toPayload(event.record))
        toast.success('Financial year saved!')
        await queryClient.invalidateQueries({ queryKey: ['fin-years'] })
      } catch (err: any) { toast.error('Save failed: ' + err.message) }
    }
    if (event.action === 'update') {
      try {
        await updateFinYear(event.id, toPayload(event.record))
        toast.success('Financial year updated!')
        await queryClient.invalidateQueries({ queryKey: ['fin-years'] })
      } catch (err: any) { toast.error('Update failed: ' + err.message) }
    }
    if (event.action === 'delete') {
      try {
        await deleteFinYear(event.id)
        toast.success('Financial year deleted!')
        await queryClient.invalidateQueries({ queryKey: ['fin-years'] })
      } catch (err: any) { toast.error('Delete failed: ' + err.message) }
    }
  }
 
  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value === 'Active' ? 'bg-green-500/10 border-green-500/20 text-green-600' : 'bg-red-500/10 border-red-500/20 text-red-600'}`}>
        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value === 'Active' ? 'bg-green-500' : 'bg-red-500'}`} />
        {String(value)}
      </span>
    ),
    locked: (value) => (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? 'bg-orange-500/10 border-orange-500/20 text-orange-600' : 'bg-muted border-border text-muted-foreground'}`}>
        {value ? '🔒 Locked' : 'Unlocked'}
      </span>
    ),
  }
 
  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>
  if (error)     return <div className="p-6 text-red-500">Failed to load financial years.</div>
 
  return (
    <>
      <Breadcrumbs items={['Dashboard', 'Finance Module', 'Financial Year Master']} />
      <div className="flex items-center gap-3 mb-4">
        <CalendarIcon className="w-5 h-5 text-amber-500" />
        <h1 className="text-xl font-heading font-bold text-foreground">Financial Year Master</h1>
      </div>
      <MasterPage
        title="Financial Year"
        fields={[
          { name: 'year',      label: 'Financial Year', type: 'text',   required: true, placeholder: 'e.g. 2024-25' },
          { name: 'startDate', label: 'Start Date',     type: 'date',   required: true },
          { name: 'endDate',   label: 'End Date',       type: 'date',   required: true },
          { name: 'status',    label: 'Status',         type: 'select', options: ['Active', 'Closed'], defaultValue: 'Active' },
          { name: 'locked',    label: 'Locked',         type: 'toggle', defaultValue: false },
        ]}
        columns={[
          { key: 'year',      label: 'Financial Year' },
          { key: 'startDate', label: 'Start Date',    hideOnMobile: true },
          { key: 'endDate',   label: 'End Date',      hideOnMobile: true },
          { key: 'status',    label: 'Status' },
          { key: 'locked',    label: 'Locked' },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}
 
export default FinancialYearMaster
 