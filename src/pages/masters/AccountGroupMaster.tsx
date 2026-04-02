import React from 'react'
import { MasterPage, type DataChangeEvent, type RecordWithId } from '@/components/MasterPage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = 'http://localhost:5000/api/account-group'

const getAccountGroups  = () => fetch(BASE).then(r => r.json())
const addAccountGroup    = (data: object) => fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
const updateAccountGroup = (id: string, data: object) => fetch(`${BASE}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
const deleteAccountGroup = (id: string) => fetch(`${BASE}/${id}`, { method: 'DELETE' }).then(r => r.json())

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbAccountGroup {
  AGId: number
  Name: string
  Code: string | null
  ParentGroupId: number | null
  Status: boolean
}

// ─── Tree Helpers ─────────────────────────────────────────────────────────────
const getDescendants = (id: string, data: RecordWithId[]): string[] => {
  const descendants: string[] = []
  const findChildren = (parentId: string) => {
    data.forEach(row => {
      if (String(row.parentGroupId) === parentId) {
        descendants.push(row._id)
        findChildren(row._id)
      }
    })
  }
  findChildren(id)
  return descendants
}

const getParentOptions = (data: RecordWithId[], currentId?: string) => {
  const invalid = currentId ? [currentId, ...getDescendants(currentId, data)] : []
  return [
    { value: '', label: '-- No Parent --' },
    ...data
      .filter(r => !invalid.includes(r._id))
      .map(r => ({ value: r._id, label: r.name as string })),
  ]
}

const getParentName = (parentId: string, data: RecordWithId[]) => {
  if (!parentId) return '—'
  return (data.find(r => r._id === parentId)?.name as string) ?? 'Unknown'
}

const getDepth = (row: RecordWithId, data: RecordWithId[]): number => {
  let depth = 0
  let currentId = row.parentGroupId as string
  while (currentId) {
    depth++
    const parent = data.find(r => r._id === currentId)
    if (!parent) break
    currentId = parent.parentGroupId as string
  }
  return depth
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  Name:          r.name          as string,
  Code:          (r.code         as string) || null,
  ParentGroupId: r.parentGroupId ? Number(r.parentGroupId) : null,
  Status:        true,
})

// ─── Component ────────────────────────────────────────────────────────────────
const AccountGroupMaster: React.FC = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ['account-groups'],
    queryFn: getAccountGroups,
  })

  const dbItems: DbAccountGroup[] = Array.isArray(dbData) ? dbData : []

  const mappedData: RecordWithId[] = dbItems.map(item => ({
    _id:           String(item.AGId),
    name:          item.Name  || '',
    code:          item.Code  || '',
    parentGroupId: item.ParentGroupId ? String(item.ParentGroupId) : '',
  }))

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === 'add') {
      try {
        await addAccountGroup(toPayload(event.record))
        toast.success('Account group saved!')
        await queryClient.invalidateQueries({ queryKey: ['account-groups'] })
      } catch (err: any) { toast.error('Save failed: ' + err.message) }
    }
    if (event.action === 'update') {
      try {
        await updateAccountGroup(event.id, toPayload(event.record))
        toast.success('Account group updated!')
        await queryClient.invalidateQueries({ queryKey: ['account-groups'] })
      } catch (err: any) { toast.error('Update failed: ' + err.message) }
    }
    if (event.action === 'delete') {
      try {
        await deleteAccountGroup(event.id)
        toast.success('Account group deleted!')
        await queryClient.invalidateQueries({ queryKey: ['account-groups'] })
      } catch (err: any) { toast.error('Delete failed: ' + err.message) }
    }
  }

  const columnRenderers: Record<string, (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode> = {
    name: (value, row, data) => {
      const depth = getDepth(row, data)
      return (
        <span className="flex items-center">
          <span style={{ width: `${depth * 1.25}rem`, display: 'inline-block' }} />
          <span>{value as string}</span>
        </span>
      )
    },
    parentGroupId: (value, _row, data) => getParentName(value as string, data),
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>
  if (error)     return <div className="p-6 text-red-500">Failed to load account groups.</div>

  return (
    <MasterPage
      title="Account Groups"
      fields={[
        { name: 'name',          label: 'Group Name',   type: 'text',   required: true },
        { name: 'code',          label: 'Code',         type: 'text',   uppercase: true },
        { name: 'parentGroupId', label: 'Parent Group', type: 'select', optionsProvider: getParentOptions },
      ]}
      columns={[
        { key: 'name',          label: 'Group Name' },
        { key: 'code',          label: 'Code' },
        { key: 'parentGroupId', label: 'Parent Group' },
      ]}
      columnRenderers={columnRenderers}
      initialData={mappedData}
      onDataEvent={handleDataEvent}
    />
  )
}

export default AccountGroupMaster