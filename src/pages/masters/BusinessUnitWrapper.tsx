import React from 'react';
import BusinessUnitPage from './BusinessUnit';
import { BusinessUnitProvider } from '@/contexts/BusinessUnitContext';

const BusinessUnitWrapper: React.FC = () => (
  <BusinessUnitProvider>
    <BusinessUnitPage />
  </BusinessUnitProvider>
);

export default BusinessUnitWrapper;

