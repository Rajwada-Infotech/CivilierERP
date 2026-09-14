import { useContext } from 'react'
import { RecordsContext } from '@/contexts/RecordsContext'

// Re-export to fix HMR compatibility
export type { RecordFileAttachment, UnifiedRecord } from '@/contexts/RecordsContext'

export function useRecords() {
  const ctx = useContext(RecordsContext)
  if (!ctx) throw new Error("useRecords must be used inside RecordsProvider")
  return ctx
}

