import React from 'react'
import { MasterPage, type RecordWithId } from '@/components/MasterPage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAccountGroups,
  addAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
} from '@/api/accountApi'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbAccountGroup {
  LHeadId: number
  LHeadName: string
  LHeadType: string
  LHeadPhone: string
  LHeadEmail: string
  LHeadStatus: number
  LGST: string | null
  LGSTState: string | null
  LCountry: string | null
}

// ─── Tree Helpers ─────────────────────────────────────────────────────────────
const getDescendants = (id: string, data: RecordWithId[]): string[] => {
  const descendants: string[] = []
  const findChildren = (parentId: string) => {
    data.forEach(row => {
      if (row.parentGroup === parentId) {
        descendants.push(row._id)
        findChildren(row._id)
      }
    })
  }
  findChildren(id)
  return descendants
}

const getParentOptions = (
  data: RecordWithId[],
  currentId?: string
): { value: string; label: string }[] => {
  const options = [{ value: '', label: '-- No Parent --' }]
  const invalidIds = currentId
    ? [currentId, ...getDescendants(currentId, data)]
    : []
  data.forEach(row => {
    if (!invalidIds.includes(row._id)) {
      options.push({ value: row._id, label: row.name as string })
    }
  })
  return options
}

const getParentGroupName = (
  parentId: string,
  data: RecordWithId[]
): string => {
  if (!parentId) return '—'
  const parent = data.find(r => r._id === parentId)
  return parent ? (parent.name as string) : 'Unknown'
}

const getNameWithIndent = (
  value: string,
  row: RecordWithId,
  data: RecordWithId[]
): React.ReactNode => {
  let depth = 0
  let currentId = row.parentGroup as string
  while (currentId) {
    depth += 1
    const parent = data.find(r => r._id === currentId)
    if (!parent) break
    currentId = parent.parentGroup as string
  }
  return (
    <span className="flex items-center">
      <span className="inline-block" style={{ width: `${depth * 1.5}rem` }} />
      <span>{value}</span>
    </span>
  )
}

const getParentGroupRenderer = (
  value: string,
  _row: RecordWithId,
  data: RecordWithId[]
): React.ReactNode => {
  return getParentGroupName(value, data)
}

// ─── Payload Builder ──────────────────────────────────────────────────────────
const toPayload = (record: Record<string, unknown>) => ({
  LHeadName: record.name as string,
  LHeadType: record.nature as string,
  LGST: (record.code as string) || null,
  LHeadPhone: `phone-${Date.now()}`,        // ← unique like email
  LHeadEmail: `account-${Date.now()}@civilier.local`,
  LHeadAddress: 'N/A',
  LHeadContactPerson: 'N/A',
  LHeadPaymentTerms: 'N/A',
  LBranchName: 'Main',
  LCountry: 'India',
  LHeadStatus: true,
})

// ─── Component ────────────────────────────────────────────────────────────────
const AccountGroupMaster = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ['account-groups'],
    queryFn: getAccountGroups,
  })

  // Always safe — never crashes if API returns error object
  const dbItems: DbAccountGroup[] = Array.isArray(dbData) ? dbData : []

  if (error) {
    console.error('API ERROR:', error)
  }

  // Map DB rows → MasterPage format
  const mappedData: RecordWithId[] = dbItems.map(item => ({
    _id: String(item.LHeadId),
    name: item.LHeadName || '',
    code: item.LGST || '',
    parentGroup: '',
    nature: item.LHeadType || '',
  }))

  const handleDataChange = async (records: RecordWithId[]) => {
    const dbIds = dbItems.map(item => String(item.LHeadId))
    const recordIds = records.map(r => r._id)

    // ── ADD ──────────────────────────────────────────────────────────────────
    const added = records.find(r => !dbIds.includes(r._id))
    if (added) {
      const payload = toPayload(added as Record<string, unknown>)
      try {
        await addAccountGroup(payload)
        toast.success('Account group saved!')
        await queryClient.invalidateQueries({ queryKey: ['account-groups'] })
      } catch (err: any) {
        toast.error('Save failed: ' + err.message)
        console.error('ADD ERROR:', err)
      }
      return
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    const deletedId = dbIds.find(id => !recordIds.includes(id))
    if (deletedId) {
      try {
        await deleteAccountGroup(deletedId)
        toast.success('Account group deleted!')
        await queryClient.invalidateQueries({ queryKey: ['account-groups'] })
      } catch (err: any) {
        toast.error('Delete failed: ' + err.message)
        console.error('DELETE ERROR:', err)
      }
      return
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    const updated = records.find(r => {
      const dbItem = dbItems.find(d => String(d.LHeadId) === r._id)
      if (!dbItem) return false
      return (
        r.name !== dbItem.LHeadName ||
        r.nature !== dbItem.LHeadType ||
        r.code !== (dbItem.LGST || '')
      )
    })

    if (updated) {
      const payload = toPayload(updated as Record<string, unknown>)
      try {
        await updateAccountGroup(updated._id, payload)
        toast.success('Account group updated!')
        await queryClient.invalidateQueries({ queryKey: ['account-groups'] })
      } catch (err: any) {
        toast.error('Update failed: ' + err.message)
        console.error('UPDATE ERROR:', err)
      }
    }
  }

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>

  if (error)
    return (
      <div className="p-6 text-red-500">
        Failed to load account groups. Please check your backend connection.
      </div>
    )

  return (
    <MasterPage
      title="Account Groups"
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        {
          name: 'code',
          label: 'Code',
          type: 'text',
          uppercase: true,
          required: true,
        },
        {
          name: 'parentGroup',
          label: 'Parent Group',
          type: 'select',
          optionsProvider: getParentOptions,
        },
        {
          name: 'nature',
          label: 'Nature',
          type: 'select',
          required: true,
          options: ['Asset', 'Liability', 'Income', 'Expense'],
        },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'code', label: 'Code' },
        { key: 'parentGroup', label: 'Parent Group' },
        { key: 'nature', label: 'Nature' },
      ]}
      columnRenderers={{
        name: getNameWithIndent,
        parentGroup: getParentGroupRenderer,
      }}
      initialData={mappedData}
      onDataChange={handleDataChange}
    />
  )
}

export default AccountGroupMaster