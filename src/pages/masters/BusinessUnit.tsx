import React from 'react';
import { MasterPage, type FieldDef, type ColumnDef } from '@/components/MasterPage';
import { useBusinessUnits } from '@/contexts/BusinessUnitContext';
import { BusinessUnit } from '@/api/businessUnitApi';
import { Building2 } from 'lucide-react';

const fields: FieldDef[] = [
  {
    name: 'Name',
    label: 'Business Unit Name',
    type: 'text',
    required: true,
    uppercase: false,
  },
  {
    name: 'Code',
    label: 'Code',
    type: 'text',
    uppercase: true,
  },
  {
    name: 'Description',
    label: 'Description',
    type: 'textarea',
    fullWidth: true,
  },
  {
    name: 'IsActive',
    label: 'Active',
    type: 'toggle',
    defaultValue: true,
  },
];

const columns: ColumnDef[] = [
  { key: 'Name', label: 'Name' },
  { key: 'Code', label: 'Code' },
  { key: 'IsActive', label: 'Status' },
  { key: 'CreatedAt', label: 'Created' },
];

const BusinessUnitPage: React.FC = () => {
  const { businessUnits, loading, reload, create, update, remove } = useBusinessUnits();

  const handleDataEvent = async (event: any) => {
    switch (event.action) {
      case 'add':
        await create(event.record as any);
        break;
      case 'update':
        await update(parseInt(event.id), event.record as any);
        break;
      case 'delete':
        await remove(parseInt(event.id));
        break;
    }
    await reload();
  };

  const columnRenderers = {
    IsActive: (value: unknown, row: any) => (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${value ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
        {value ? 'Active' : 'Inactive'}
      </span>
    ),
    CreatedAt: (value: unknown) => (
      <span className="text-xs text-muted-foreground">
        {new Date(value as string).toLocaleDateString()}
      </span>
    ),
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Building2 className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Business Units</h1>
          <p className="text-muted-foreground">Manage your business unit master data</p>
        </div>
      </div>
      
      <MasterPage
        title="Business Unit"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={businessUnits.map((unit: BusinessUnit) => ({ ...unit, _id: unit.id.toString() }))}
        loading={loading}
        onDataEvent={handleDataEvent}
      />
    </div>
  );
};

export default BusinessUnitPage;

