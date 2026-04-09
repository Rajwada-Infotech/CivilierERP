import React from 'react'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { MasterPage, type DataChangeEvent, type RecordWithId } from '@/components/MasterPage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
} from '@/api/customerApi'

const fields = [
  { name: 'name', label: 'Customer Name', type: 'text', required: true },
  { name: 'contact', label: 'Contact Person', type: 'text' },
  { name: 'phone', label: 'Phone Number', type: 'text' },
  { name: 'email', label: 'Email Address', type: 'text' },
  { name: 'gst', label: 'GST Number', type: 'text', uppercase: true },
  { name: 'pan', label: 'PAN Number', type: 'text', uppercase: true },
  { name: 'type', label: 'Customer Type', type: 'select', options: ['Individual', 'Company', 'Government', 'NGO', 'Other'] },
  { name: 'paymentTerms', label: 'Payment Terms', type: 'select', options: ['Advance', '15 Days', '30 Days', '45 Days', '60 Days'] },
  { name: 'creditLimit', label: 'Credit Limit (₹)', type: 'number', prefix: '₹' },
  { name: 'address', label: 'Address', type: 'textarea', fullWidth: true },
  { name: 'status', label: 'Status', type: 'toggle', defaultValue: true },
];

const columns = [
  { key: 'name', label: 'Customer Name' },
  { key: 'contact', label: 'Contact Person' },
  { key: 'phone', label: 'Phone' },
  { key: 'gst', label: 'GST No.' },
  { key: 'type', label: 'Type' },
  { key: 'paymentTerms', label: 'Payment Terms' },
  { key: 'status', label: 'Status' },
];

const CustomerMaster = () => {
  const queryClient = useQueryClient()

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ['customers'],
    queryFn: getCustomers,
  })

  const dbItems = Array.isArray(dbData) ? dbData : []

  const mappedData: RecordWithId[] = dbItems.map(item => ({
    _id: String(item.CustomerId || item.id || item._id),
    name: item.Name || item.name || '',
    contact: item.ContactPerson || item.contact || '',
    phone: item.Phone || item.phone || '',
    email: item.Email || item.email || '',
    gst: item.GST || item.gst || '',
    pan: item.PAN || item.pan || '',
    type: item.Type || item.type || '',
    paymentTerms: item.PaymentTerms || item.paymentTerms || '',
    creditLimit: item.CreditLimit || item.creditLimit || '',
    address: item.Address || item.address || '',
    status: item.Status !== false,
  }))

  const toPayload = (r: Record<string, unknown>) => ({
    Name: (r.name as string) || null,
    ContactPerson: (r.contact as string) || null,
    Phone: (r.phone as string) || null,
    Email: (r.email as string) || null,
    GST: (r.gst as string) || null,
    PAN: (r.pan as string) || null,
    Type: (r.type as string) || null,
    PaymentTerms: (r.paymentTerms as string) || null,
    CreditLimit: r.creditLimit ? Number(r.creditLimit) : null,
    Address: (r.address as string) || null,
    Status: r.status !== false,
  })

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === 'add') {
      try {
        await addCustomer(toPayload(event.record))
        toast.success('Customer saved!')
        await queryClient.invalidateQueries({ queryKey: ['customers'] })
      } catch (err: any) { toast.error('Save failed: ' + err.message) }
    }
    if (event.action === 'update') {
      try {
        await updateCustomer(event.id, toPayload(event.record))
        toast.success('Customer updated!')
        await queryClient.invalidateQueries({ queryKey: ['customers'] })
      } catch (err: any) { toast.error('Update failed: ' + err.message) }
    }
    if (event.action === 'delete') {
      try {
        await deleteCustomer(event.id)
        toast.success('Customer deleted!')
        await queryClient.invalidateQueries({ queryKey: ['customers'] })
      } catch (err: any) { toast.error('Delete failed: ' + err.message) }
    }
  }

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading customers...</div>
  if (error) return <div className="p-6 text-destructive">Failed to load customers.</div>

  return (
    <>
      <Breadcrumbs items={['Dashboard', 'Finance Module', 'Customer Master']} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">Customer Master</h1>
      <MasterPage
        title="Customer"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  )
}

export default CustomerMaster
