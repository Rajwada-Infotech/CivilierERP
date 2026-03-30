import React from 'react'
import { MasterPage, type RecordWithId } from '@/components/MasterPage'
import type { FieldDef, ColumnDef } from '@/components/MasterPage'

import { Layers } from 'lucide-react'

// Tree helpers
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

const isDescendant = (ancestorId: string, descendantId: string, data: RecordWithId[]): boolean => {
  return getDescendants(ancestorId, data).includes(descendantId)
}

const getParentOptions = (data: RecordWithId[], currentId: string): {value: string, label: string}[] => {
  const options = [{value: '', label: '-- No Parent --'}]
  const invalidIds = currentId ? [currentId, ...getDescendants(currentId, data)] : []
  data.forEach(row => {
    if (!invalidIds.includes(row._id)) {
      options.push({value: row._id, label: row.name as string})
    }
  })
  return options
}

const getParentGroupName = (parentId: string, data: RecordWithId[]): string => {
  if (!parentId) return '—'
  const parent = data.find(r => r._id === parentId)
  return parent ? (parent.name as string) : 'Unknown'
}

const getNameWithIndent = (value: string, row: RecordWithId, data: RecordWithId[]): React.ReactNode => {
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
      <span className="w-[calc(1.5rem*var(--depth,0))] inline-block" style={{'--depth': depth} as React.CSSProperties} />
      <span>{value}</span>
    </span>
  )
}

const getParentGroupRenderer = (value: string, row: RecordWithId, data: RecordWithId[]): React.ReactNode => {
  return getParentGroupName(value, data)
  return getParentGroupName(value as string, data)
}

  const handleDataChange = (records: Record<string, unknown>[]) => {
    // Cycle validation
    const dataWithIds: RecordWithId[] = records.map((r, i) => ({...r, _id: `local-${i}` as string}))
    dataWithIds.forEach(row => {
      if (row.parentGroup && isDescendant(row.parentGroup as string, row._id as string, dataWithIds)) {
        console.warn('Circular reference detected:', row.name)
      }
    })
    console.log('Data changed:', records)
  }

  const AccountGroupMaster = () => {
const handleDataChange = (records: Record<string, unknown>[]) => {
    // Cycle validation
  const dataWithIds: RecordWithId[] = records.map((r, i) => ({...r, _id: `local-${i}` as string}))
    dataWithIds.forEach(row => {
      if (row.parentGroup && isDescendant(row.parentGroup as string, row._id as string, dataWithIds)) {
        console.warn('Circular reference detected:', row.name)
      }
    })
    console.log('Data changed:', records)
  }

  return (
    <MasterPage 
      title="Account Groups" 
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'code', label: 'Code', type: 'text', uppercase: true, required: true },
        { 
          name: 'parentGroup', 
          label: 'Parent Group', 
          type: 'select',
          optionsProvider: getParentOptions
        },
        { name: 'nature', label: 'Nature', type: 'select', required: true, options: ['Asset', 'Liability', 'Income', 'Expense'] },
      ]}
      columns={[
        { key: 'name', label: 'Name' },
        { key: 'code', label: 'Code' },
        { key: 'parentGroup', label: 'Parent Group' },
        { key: 'nature', label: 'Nature' },
      ]}
      columnRenderers={{
        name: getNameWithIndent,
        parentGroup: getParentGroupRenderer
      }}
      initialData={[]}
      onDataChange={handleDataChange}
    />
  )
}

export default AccountGroupMaster

