import { fetchWithAuth } from '@/lib/fetchWithAuth'
import React from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MasterPage, type DataChangeEvent, type RecordWithId } from '@/components/MasterPage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = '/api/document-type'

const getDocs    = () => fetchWithAuth(BASE).then(r => r.json())
const addDoc     = (data: object) => fetchWithAuth(BASE, { method: 'POST',
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json())
const updateDoc  = (id: string, data: object) => fetchWithAuth(`${BASE}/${id}`, { method: 'PUT',
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json())
const deleteDoc  = (id: string) => fetchWithAuth(`${BASE}/${id}`, { method: 'DELETE' }).then(r => r.json())

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbDoc {
  id: number
  code: string | null
  name: string | null
  description: string | null
  module: string | null
  status: string | null
  remarks: string | null
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  code:        (r.code        as string) || null,
  name:        (r.name        as string) || null,
  description: (r.description as string) || null,
  module:      (r.module      as string) || null,
  status:      (r.status      as string) || 'Active',
  remarks:     (r.remarks     as string) || null,
})

// ─── Component ────────────────────────────────────────────────────────────────
const TypeOfDocMaster: React.FC = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ['document-types'],
    queryFn: getDocs,
    staleTime: 5 * 60 * 1000,
  })

  const dbItems: DbDoc[] = Array.isArray(dbData) ? dbData : []

  const mappedData: RecordWithId[] = dbItems.map(item => ({
    _id:         String(item.id),
    code:        item.code        || '',
    name:        item.name        || '',
    description: item.description || '',
    module:      item.module      || '',
    status:      item.status      || 'Active',
    remarks:     item.remarks     || '',
  }))

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === 'add') {
      try {
        await addDoc(toPayload(event.record))
        toast.success('Document type saved!')
        await queryClient.invalidateQueries({ queryKey: ['document-types'] })
      } catch (err: any) { toast.error('Save failed: ' + err.message) }
    }
    if (event.action === 'update') {
      try {
        await updateDoc(event.id, toPayload(event.record))
        toast.success('Document type updated!')
        await queryClient.invalidateQueries({ queryKey: ['document-types'] })
      } catch (err: any) { toast.error('Update failed: ' + err.message) }
    }
    if (event.action === 'delete') {
      try {
        await deleteDoc(event.id)
        toast.success('Document type deleted!')
        await queryClient.invalidateQueries({ queryKey: ['document-types'] })
      } catch (err: any) { toast.error('Delete failed: ' + err.message) }
    }
  }

  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => {
      const map: Record<string, string> = {
        'Active':   'bg-green-500/10 border-green-500/20 text-green-600',
        'Inactive': 'bg-red-500/10 border-red-500/20 text-red-600',
        'Draft':    'bg-amber-500/10 border-amber-500/20 text-amber-600',
      }
      const cls = map[value as string] ?? map['Active']
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${cls}`}>
          <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-70" />
          {String(value || 'Active')}
        </span>
      )
    },
    remarks:     (value) => <span className="text-muted-foreground text-xs italic">{String(value || '—')}</span>,
    description: (value) => <span className="text-muted-foreground text-xs truncate max-w-[180px] block">{String(value || '—')}</span>,
    module:      (value) => value ? (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border bg-blue-500/10 border-blue-500/20 text-blue-600">
        {String(value)}
      </span>
    ) : <span className="text-muted-foreground">—</span>,
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>
  if (error)     return <div className="p-6 text-red-500">Failed to load document types.</div>

  return (
    <>
      <Breadcrumbs items={['Dashboard', 'Finance Module', 'Type of Doc Master']} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Type of Doc Master</h1>
      <MasterPage
        title="Type of Doc"
        fields={[
          { name: 'code',        label: 'Doc Code',    type: 'text',     required: true, uppercase: true },
          { name: 'name',        label: 'Name',        type: 'text',     required: true },
          { name: 'module',      label: 'Module',      type: 'text' },
          { name: 'status',      label: 'Status',      type: 'select',   options: ['Active', 'Inactive', 'Draft'], defaultValue: 'Active' },
          { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
          { name: 'remarks',     label: 'Remarks',     type: 'textarea', fullWidth: true },
        ]}
        columns={[
          { key: 'code',        label: 'Doc Code' },
          { key: 'name',        label: 'Name' },
          { key: 'module',      label: 'Module',      hideOnMobile: true },
          { key: 'status',      label: 'Status' },
          { key: 'description', label: 'Description', hideOnMobile: true },
          { key: 'remarks',     label: 'Remarks',     hideOnMobile: true },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default TypeOfDocMaster