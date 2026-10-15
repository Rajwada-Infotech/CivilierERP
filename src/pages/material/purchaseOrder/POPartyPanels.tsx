import { User, CircleDollarSign, Truck, Phone, Mail, MapPin } from "lucide-react";
import type { POState } from "./usePurchaseOrder";

// Supplier, company and project details, fetched when each is chosen.
export function POPartyPanels({ m }: { m: POState }) {
  const { supplierDetails, companyDetails, projectDetails, items } = m;
  return (
    <>
      {/* ── Supplier, Company & Project Info Panels (auto-fetched on selection) ──── */}
      {(supplierDetails || companyDetails || projectDetails) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Supplier info */}
          {supplierDetails && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-3">
                <Truck
                  size={11}
                  className="text-emerald-600 dark:text-emerald-400"
                />
                Supplier Details
              </h3>
              <dl className="space-y-2 text-sm">
                {supplierDetails.LHeadAddress && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Address
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5">
                      {supplierDetails.LHeadAddress}
                    </dd>
                  </div>
                )}
                {supplierDetails.LHeadContactPerson && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Contact Person
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                      <User size={12} className="text-muted-foreground" />
                      {supplierDetails.LHeadContactPerson}
                    </dd>
                  </div>
                )}
                {supplierDetails.LHeadPhone && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Phone
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                      <Phone size={12} className="text-muted-foreground" />
                      {supplierDetails.LHeadPhone}
                    </dd>
                  </div>
                )}
                {supplierDetails.LHeadEmail && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Email
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                      <Mail size={12} className="text-muted-foreground" />
                      {supplierDetails.LHeadEmail}
                    </dd>
                  </div>
                )}
                {supplierDetails.LGST && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      GSTIN
                    </dt>
                    <dd className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 bg-emerald-500/[0.05] px-2 py-1 rounded-md inline-block">
                      {supplierDetails.LGST}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Billing details */}
          {companyDetails && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-3">
                <CircleDollarSign
                  size={11}
                  className="text-emerald-600 dark:text-emerald-400"
                />
                Billing Details
              </h3>
              <dl className="space-y-2 text-sm">
                {(companyDetails.address || companyDetails.city) && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Billing Address
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5">
                      {[
                        companyDetails.address,
                        companyDetails.address_line2,
                        companyDetails.city,
                        companyDetails.state,
                        companyDetails.pincode,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </dd>
                  </div>
                )}
                {companyDetails.phone_number && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Phone
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                      <Phone size={12} className="text-muted-foreground" />
                      {companyDetails.phone_number}
                    </dd>
                  </div>
                )}
                {companyDetails.email && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Email
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                      <Mail size={12} className="text-muted-foreground" />
                      {companyDetails.email}
                    </dd>
                  </div>
                )}
                {companyDetails.gst_no && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      GSTIN
                    </dt>
                    <dd className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 bg-emerald-500/[0.05] px-2 py-1 rounded-md inline-block">
                      {companyDetails.gst_no}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Project info — delivery address */}
          {projectDetails && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5 mb-3">
                <MapPin
                  size={11}
                  className="text-emerald-600 dark:text-emerald-400"
                />
                Project Details
              </h3>
              <dl className="space-y-2 text-sm">
                {(projectDetails.address || projectDetails.city) && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Delivery Address
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5">
                      {[
                        projectDetails.address,
                        projectDetails.address_line2,
                        projectDetails.city,
                        projectDetails.state,
                        projectDetails.pincode,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </dd>
                  </div>
                )}
                {projectDetails.phone_number && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Phone
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                      <Phone size={12} className="text-muted-foreground" />
                      {projectDetails.phone_number}
                    </dd>
                  </div>
                )}
                {projectDetails.email && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      Email
                    </dt>
                    <dd className="text-foreground font-medium mt-0.5 flex items-center gap-1.5">
                      <Mail size={12} className="text-muted-foreground" />
                      {projectDetails.email}
                    </dd>
                  </div>
                )}
                {projectDetails.gst_no && (
                  <div>
                    <dt className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      GSTIN
                    </dt>
                    <dd className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 bg-emerald-500/[0.05] px-2 py-1 rounded-md inline-block">
                      {projectDetails.gst_no}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      )}
    </>
  );
}
