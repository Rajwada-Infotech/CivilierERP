import { toast } from "sonner";
import { Truck, Clock, Camera, Paperclip, AlertCircle } from "lucide-react";
import { DateTimeInput } from "@/components/ui/date-input";
import { inp, FieldLabel, SectionCard, SectionTitle, AttachmentThumb, toLocalDateTimeInput } from "./config";
import type { VIOState } from "./useVehicleInOut";

// The vehicle, driver, weighbridge figures and attachments.
export function VIOVehicleDetails({ m }: { m: VIOState }) {
  const { page, errors, setErrors, uploading, fileInputRef, setShowCamera, setCameraError, setCapturingPoItemId, form, pf, handleFileUpload, removeAttachment } = m;
  return (
    <>
      {/* ── Section 3: Vehicle Details ── */}
      <SectionCard>
        <SectionTitle
          icon={Truck}
          label="Vehicle Details"
          sub="Vehicle number, entry/exit times, challan"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Vehicle No */}
          <div>
            <FieldLabel required>Vehicle Number</FieldLabel>
            <input
              type="text"
              value={form.vehicleNo}
              onChange={(e) =>
                pf({ vehicleNo: e.target.value.toUpperCase() })
              }
              className={`${inp} font-heading uppercase ${errors.vehicleNo ? "border-destructive" : ""}`}
              placeholder="e.g. WB-01-AB-1234"
            />
            {errors.vehicleNo && (
              <p className="text-destructive text-[0.6875rem] mt-1 flex items-center gap-1">
                <AlertCircle size={10} />
                {errors.vehicleNo}
              </p>
            )}
          </div>

          {/* Entry Time */}
          <div>
            <FieldLabel required>Entry Time</FieldLabel>
            <div className="relative">
              <Clock
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <DateTimeInput
                value={form.entryTime}
                onChange={(e) => pf({ entryTime: e.target.value })}
                className={`${inp} pl-9 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${errors.entryTime ? "border-destructive" : ""}`}
              />
            </div>
            {errors.entryTime && (
              <p className="text-destructive text-[0.6875rem] mt-1 flex items-center gap-1">
                <AlertCircle size={10} />
                {errors.entryTime}
              </p>
            )}
          </div>

          {/* Exit Time */}
          <div>
            <FieldLabel>Exit Time</FieldLabel>
            <div className="relative">
              <Clock
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <DateTimeInput
                value={form.exitTime ?? ""}
                max={toLocalDateTimeInput(new Date())}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val && val > toLocalDateTimeInput(new Date())) {
                    toast.error("Exit time can't be in the future — backfill an earlier time instead.");
                    pf({ exitTime: toLocalDateTimeInput(new Date()) });
                    return;
                  }
                  pf({ exitTime: val || null });
                }}
                className={`${inp} pl-9 [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer`}
              />
            </div>
            <p className="text-[0.625rem] text-muted-foreground mt-1">
              Defaults to now — backfill an earlier time, or clear if the vehicle hasn't exited yet
            </p>
          </div>

          {/* Supplier Ref / Challan No */}
          <div>
            <FieldLabel required>Supplier Ref / Challan No</FieldLabel>
            <input
              type="text"
              value={form.challanNo}
              onChange={(e) => {
                pf({ challanNo: e.target.value });
                if (errors.challanNo) setErrors((p) => ({ ...p, challanNo: "" }));
              }}
              className={`${inp} ${errors.challanNo ? "border-destructive" : ""}`}
              placeholder="e.g. CH-20240601-001"
            />
            {errors.challanNo && (
              <p className="text-[0.625rem] text-destructive mt-1">{errors.challanNo}</p>
            )}
          </div>

          {/* Attachment / Camera */}
          <div className="sm:col-span-2">
            <FieldLabel>Attachments / Car Plate Photos</FieldLabel>
            <div className="flex items-center gap-2 flex-wrap">
              {/* File pick — multiple files at once */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) handleFileUpload(files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-foreground/30 text-xs font-medium hover:bg-primary/5 transition-colors disabled:opacity-50"
              >
                <Paperclip size={12} />
                {uploading ? "Uploading…" : "Attach Files"}
              </button>

              {/* Camera capture — opens live in-page camera */}
              <button
                type="button"
                onClick={() => {
                  setCameraError(null);
                  setCapturingPoItemId(null);
                  setShowCamera(true);
                }}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-foreground/30 text-xs font-medium hover:bg-primary/5 transition-colors disabled:opacity-50"
              >
                <Camera size={12} /> Camera
              </button>
            </div>

            {/* Preview list — multiple attachments */}
            {form.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2.5">
                {form.attachments.map((a) => (
                  <AttachmentThumb
                    key={a.id}
                    attachment={a}
                    onRemove={() => removeAttachment(a.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    </>
  );
}
