import React from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MasterPage, type DataChangeEvent, type RecordWithId } from '@/components/MasterPage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE       = 'http://localhost:5000/api/account-head'
const GROUPS_URL = 'http://localhost:5000/api/account-group'

const getLedgers     = () => fetch(BASE).then(r => r.json())
const getGroups      = () => fetch(GROUPS_URL).then(r => r.json())
const addLedger      = (data: object) => fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
const updateLedger   = (id: string, data: object) => fetch(`${BASE}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
const deleteLedger   = (id: string) => fetch(`${BASE}/${id}`, { method: 'DELETE' }).then(r => r.json())

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbLedger {
  LHeadId: number
  LHeadName: string
  LHeadType: string | null
  LHeadPhone: string | null
  LHeadEmail: string | null
  LHeadStatus: number
  LGST: string | null
  LGSTState: string | null
  LCountry: string | null
  LBelongsTo: string | null
  LDescription: string | null
}

interface DbGroup {
  AGId: number
  Name: string
  Code: string | null
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  LHeadName:          r.ledgerName    as string,
  LHeadType:          (r.accountGroup as string) || null,
  LHeadPhone:         '0000000000',
  LHeadEmail:         `ledger-${Date.now()}@civilier.local`,
  LHeadAddress:       'N/A',
  LHeadContactPerson: 'N/A',
  LHeadStatus:        1,
  LHeadPaymentTerms:  'N/A',
  LBranchName:        'Main',
  LGST:               (r.shortCode    as string) || null,
  LGSTState:          null,
  LCountry:           'India',
  LBelongsTo:         (r.accountGroup as string) || null,
  LDescription:       (r.description  as string) || null,
})

// ─── Component ────────────────────────────────────────────────────────────────
const GeneralLedgerMaster: React.FC = () => {
  const queryClient = useQueryClient()

  const { data: dbData,   isLoading: loadingLedgers } = useQuery({ queryKey: ['ledgers'],        queryFn: getLedgers })
  const { data: grpData,  isLoading: loadingGroups  } = useQuery({ queryKey: ['account-groups'], queryFn: getGroups  })

  const dbItems:  DbLedger[] = Array.isArray(dbData)  ? dbData  : []
  const dbGroups: DbGroup[]  = Array.isArray(grpData) ? grpData : []

  // Build group options for dropdown
  const groupOptions = dbGroups.map(g => g.Name).filter(Boolean)

  const mappedData: RecordWithId[] = dbItems.map(item => ({
    _id:          String(item.LHeadId),
    ledgerName:   item.LHeadName    || '',
    shortCode:    item.LGST         || '',
    accountGroup: item.LBelongsTo   || item.LHeadType || '',
    description:  item.LDescription || '',
    status:       item.LHeadStatus === 1,
  }))

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === 'add') {
      try {
        await addLedger(toPayload(event.record))
        toast.success('Ledger saved!')
        await queryClient.invalidateQueries({ queryKey: ['ledgers'] })
      } catch (err: any) { toast.error('Save failed: ' + err.message) }
    }
    if (event.action === 'update') {
      try {
        await updateLedger(event.id, toPayload(event.record))
        toast.success('Ledger updated!')
        await queryClient.invalidateQueries({ queryKey: ['ledgers'] })
      } catch (err: any) { toast.error('Update failed: ' + err.message) }
    }
    if (event.action === 'delete') {
      try {
        await deleteLedger(event.id)
        toast.success('Ledger deleted!')
        await queryClient.invalidateQueries({ queryKey: ['ledgers'] })
      } catch (err: any) { toast.error('Delete failed: ' + err.message) }
    }
  }

  const columnRenderers: Record<string, (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode> = {
    status: (value) => (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? 'bg-green-500/10 border-green-500/20 text-green-600' : 'bg-red-500/10 border-red-500/20 text-red-600'}`}>
        {value ? 'Active' : 'Inactive'}
      </span>
    ),
    accountGroup: (value) => (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border bg-blue-500/10 border-blue-500/20 text-blue-600">
        {(value as string) || '—'}
      </span>
    ),
  }

  if (loadingLedgers || loadingGroups)
    return <div className="p-6 text-muted-foreground">Loading...</div>

  return (
    <>
      <Breadcrumbs items={['Dashboard', 'Masters', 'General Ledger']} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">General Ledger</h1>

      <MasterPage
        title="Ledger"
        fields={[
          { name: 'ledgerName',   label: 'Ledger Name',    type: 'text',     required: true },
          { name: 'shortCode',    label: 'Short Code',     type: 'text',     uppercase: true, required: true },
          { name: 'accountGroup', label: 'Account Group',  type: 'select',   required: true, options: groupOptions },
          { name: 'description',  label: 'Description',    type: 'textarea', fullWidth: true },
        ]}
        columns={[
          { key: 'ledgerName',   label: 'Ledger Name' },
          { key: 'shortCode',    label: 'Short Code',   hideOnMobile: true },
          { key: 'accountGroup', label: 'Account Group' },
          { key: 'description',  label: 'Description',  hideOnMobile: true },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default GeneralLedgerMaster