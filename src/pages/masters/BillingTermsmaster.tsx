import React from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { MasterPage, type FieldDef, type ColumnDef, type RecordWithId } from '@/components/MasterPage';
import { useBillingTerms } from '@/contexts/BillingTermsContext';
import { Book, Percent, Calendar, FileText, ToggleRight } from 'lucide-react';
import { toast } from 'sonner';

interface BillingTermDisplay extends RecordWithId {
  name: string;
  billType: string;
  discountType: string;
  discountValue: number;
  paymentDueDays: number;
  status: boolean;
}

const BillingTermsMaster: React.FC = () => {
  const { billingTerms, setBillingTerms } = useBillingTerms();

  const fields: FieldDef[] = [
    {
      name: 'name',
      label: 'Term Name',
      type: 'text',
      required: true,
    },
    {
      name: 'billType',
      label: 'Bill Type',
      type: 'select',
      required: true,
      options: [
        'Tax Invoice',
        'Proforma Invoice', 
        'Credit Note',
        'Debit Note',
        'Bill of Supply',
        'Receipt Voucher',
        'Delivery Challan',
        'Self Invoice'
      ],
    },
    {
      name: 'discountType',
      label: 'Discount Type',
      type: 'select',
      required: true,
      options: ['percentage', 'flat', 'none'],
    },
    {
      name: 'discountValue',
      label: 'Discount Value',
      type: 'number',
      required: true,
    },
    {
      name: 'paymentDueDays',
      label: 'Payment Due (days)',
      type: 'number',
      required: true,
    },
    {
      name: 'description',
      label: 'Description',
      type: 'textarea',
      fullWidth: true,
    },
    {
      name: 'status',
      label: 'Status',
      type: 'toggle',
      defaultValue: true,
    },
  ];

  const columnRenderers = {
    discountDisplay: (value: unknown, row: any) => {
      const dt = row.discountType as string;
      const dv = row.discountValue as number;
      if (dt === 'none') return 'None';
      return `${dv} ${dt === 'percentage' ? '%' : '₹'}`;
    },
    status: (value: unknown) => {
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
            value
              ? "bg-primary/10 text-primary border-primary/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value ? "bg-primary" : "bg-destructive"}`}
          />
          {value ? "Active" : "Inactive"}
        </span>
      );
    },
  };

  const columns: ColumnDef[] = [
    { key: 'name', label: 'Term Name' },
    { key: 'billType', label: 'Bill Type' },
    { key: 'discountType', label: 'Discount', hideOnMobile: false },
    { key: 'paymentDueDays', label: 'Due (days)' },
    { key: 'status', label: 'Status', hideOnMobile: false },
  ];

  const handleDataChange = (records: Record<string, unknown>[]) => {
    setBillingTerms(records as any[]);
    toast.success('Billing terms updated successfully!');
  };

  const billingTermsDisplay = billingTerms.map((term) => ({
    ...term,
    _id: term._id || `bt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  }));

  return (
    <>
      <Breadcrumbs items={['Masters', 'Billing Terms']} />
      
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Book className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-heading font-bold text-foreground">
            Billing Terms Master
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure standard billing terms, discount structures, and payment schedules for automated invoicing
        </p>
      </div>

      <MasterPage
        title="Billing Term"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={billingTermsDisplay}
        onDataChange={handleDataChange}
      />
    </>
  );
};

export default BillingTermsMaster;

