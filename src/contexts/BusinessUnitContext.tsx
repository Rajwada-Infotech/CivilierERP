import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  getBusinessUnits,
  createBusinessUnit,
  updateBusinessUnit,
  deleteBusinessUnit,
  type BusinessUnit,
  type CreateBusinessUnitPayload,
  type UpdateBusinessUnitPayload
} from '@/api/businessUnitApi';
import { toast } from 'sonner';

interface BusinessUnitContextType {
  businessUnits: BusinessUnit[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (data: CreateBusinessUnitPayload) => Promise<void>;
  update: (id: number, data: UpdateBusinessUnitPayload) => Promise<void>;
  remove: (id: number) => Promise<void>;
  options: { id: number; label: string }[];
}

const BusinessUnitContext = createContext<BusinessUnitContextType | null>(null);

export const useBusinessUnits = () => {
  const context = useContext(BusinessUnitContext);
  if (!context) {
    throw new Error('useBusinessUnits must be used within BusinessUnitProvider');
  }
  return context;
};

export const BusinessUnitProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [businessUnits, setBusinessUnits] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<{ id: number; label: string }[]>([]);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getBusinessUnits({ limit: 1000 });
      setBusinessUnits(data);
      
      // Build options from active records
      const activeOptions = data
        .filter((unit: BusinessUnit) => unit.IsActive)
        .map((unit: BusinessUnit) => ({
          id: unit.id,
          label: `${unit.Name}${unit.Code ? ` (${unit.Code})` : ''}`
        }));
      setOptions(activeOptions);
    } catch (err: any) {
      setError(err.message);
      toast.error('Failed to load Business Units');
    } finally {
      setLoading(false);
    }
  };

  const create = async (data: CreateBusinessUnitPayload) => {
    try {
      await createBusinessUnit(data);
      toast.success('Business Unit created successfully');
      await reload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create Business Unit');
      throw err;
    }
  };

  const update = async (id: number, data: UpdateBusinessUnitPayload) => {
    try {
      await updateBusinessUnit(id, data);
      toast.success('Business Unit updated successfully');
      await reload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update Business Unit');
      throw err;
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteBusinessUnit(id);
      toast.success('Business Unit deleted successfully');
      await reload();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete Business Unit');
      throw err;
    }
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <BusinessUnitContext.Provider value={{
      businessUnits,
      loading,
      error,
      reload,
      create,
      update,
      remove,
      options
    }}>
      {children}
    </BusinessUnitContext.Provider>
  );
};

