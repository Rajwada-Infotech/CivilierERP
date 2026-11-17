import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Location } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { HrPayrollShell } from "@/components/hrpayroll/HrPayrollShell";
import { HrError, HrSkeleton } from "@/components/hrpayroll/HrUi";
import { LocationAreaPicker, LocationMapView, emptyGeo, type GeoValue } from "@/components/hrpayroll/LocationAreaPicker";
import { MasterPage, type ColumnDef, type DataChangeEvent, type FieldDef, type RecordWithId } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import {
  addWorkLocation,
  deleteWorkLocation,
  getWorkLocations,
  updateWorkLocation,
  type WorkLocationPayload,
  type WorkLocationRow,
} from "@/api/workLocationMasterApi";

const mapRow = (r: WorkLocationRow): RecordWithId => ({
  _id: String(r.LocationId),
  locationName: r.LocationName,
  locationCode: r.LocationCode,
  latitude: Number(r.Latitude),
  longitude: Number(r.Longitude),
  radius: r.RadiusMeters,
  address: r.Address || "",
  isActive: Boolean(r.IsActive),
  // The form's single map field.
  geo: { latitude: String(r.Latitude), longitude: String(r.Longitude), radius: String(r.RadiusMeters), address: r.Address || "" } satisfies GeoValue,
});

const columns: ColumnDef[] = [
  { key: "locationName", label: "Location Name" },
  { key: "locationCode", label: "Location Code" },
  { key: "latitude", label: "Latitude", hideOnMobile: true },
  { key: "longitude", label: "Longitude", hideOnMobile: true },
  { key: "radius", label: "Area (m)", hideOnMobile: true },
  { key: "address", label: "Address", hideOnMobile: true, sortable: false },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Location Name", accessor: "locationName" },
  { header: "Location Code", accessor: "locationCode" },
  { header: "Latitude", accessor: "latitude" },
  { header: "Longitude", accessor: "longitude" },
  { header: "Area Radius (m)", accessor: "radius" },
  { header: "Address", accessor: "address" },
  { header: "Status", accessor: "isActive" },
];

const fields: FieldDef[] = [
  { name: "locationName", label: "Location Name", type: "text", required: true },
  { name: "locationCode", label: "Location Code", type: "text", required: true, uppercase: true },
  {
    name: "geo",
    label: "",
    type: "custom",
    fullWidth: true,
    defaultValue: undefined,
    render: ({ value, onChange }) => <LocationAreaPicker value={value as GeoValue} onChange={onChange} />,
  },
  { name: "isActive", label: "Status", type: "toggle", defaultValue: true },
];

const toPayload = (r: Record<string, any>): WorkLocationPayload => {
  const g: GeoValue = { ...emptyGeo, ...(r.geo && typeof r.geo === "object" ? r.geo : {}) };
  return {
    LocationName: r.locationName?.trim() || "",
    LocationCode: r.locationCode?.trim() || "",
    Latitude: g.latitude.trim(),
    Longitude: g.longitude.trim(),
    Address: g.address.trim() || null,
    RadiusMeters: Number(g.radius) || 100,
    IsActive: r.isActive !== false,
  };
};

const WorkLocationMaster: React.FC = () => {
  const rights = usePageRights("work-location-master");
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["work-location-master"], queryFn: getWorkLocations, staleTime: 60 * 1000 });
  const mappedData: RecordWithId[] = (Array.isArray(data) ? data : []).map(mapRow);

  // Errors are thrown (not toasted here): MasterPage shows them and keeps the form open for correction.
  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add" || event.action === "update") {
      const p = toPayload(event.record);
      if (!p.LocationName) throw new Error("Location Name is required");
      if (!p.LocationCode) throw new Error("Location Code is required");
      if (p.Latitude === "" || p.Longitude === "") throw new Error("Pick the location on the map or enter its Latitude and Longitude");
      if (event.action === "add") await addWorkLocation(p);
      else await updateWorkLocation(Number(event.id), p);
    }
    if (event.action === "delete") await deleteWorkLocation(Number(event.id));
    await queryClient.invalidateQueries({ queryKey: ["work-location-master"] });
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "HR and Payroll", "Setup", "Work Location"]} />
      <HrPayrollShell title="Work Location" subtitle="Where employees work -- name, map point, address and marked area" icon={Location}>
        {isLoading ? (
          <HrSkeleton />
        ) : error ? (
          <HrError text="Failed to load work locations." />
        ) : (
          <MasterPage
            title="Work Location"
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            fields={fields}
            columns={columns}
            initialData={mappedData}
            onDataEvent={handleDataEvent}
            exportConfig={{ title: "Work Location Master", filename: "work-location-master", columns: exportColumns }}
            viewConfig={{
              title: "Work Location Details",
              fields: [
                { key: "locationName", label: "Location Name" },
                { key: "locationCode", label: "Location Code" },
                { key: "latitude", label: "Latitude", mono: true },
                { key: "longitude", label: "Longitude", mono: true },
                { key: "radius", label: "Area Radius (metres)", mono: true },
                { key: "isActive", label: "Status" },
                { key: "address", label: "Address", wide: true },
                {
                  key: "map",
                  label: "Map",
                  wide: true,
                  render: (_v, row) => <LocationMapView latitude={Number(row.latitude)} longitude={Number(row.longitude)} radius={Number(row.radius)} />,
                },
              ],
            }}
          />
        )}
      </HrPayrollShell>
    </>
  );
};

export default WorkLocationMaster;
