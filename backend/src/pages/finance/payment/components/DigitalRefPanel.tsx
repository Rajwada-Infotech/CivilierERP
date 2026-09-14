import React from "react";
import { Hash } from "lucide-react";
import { Field, InputField } from "./FormFields";
import type { PaymentRecord } from "../types";

export function DigitalRefPanel({
  mode,
  form,
  set,
}: {
  mode: string;
  form: Omit<PaymentRecord, "id">;
  set: <K extends keyof Omit<PaymentRecord, "id">>(
    field: K,
    value: Omit<PaymentRecord, "id">[K],
  ) => void;
}) {
  const configs: Record<
    string,
    {
      field: keyof Omit<PaymentRecord, "id">;
      label: string;
      placeholder: string;
      hint: string;
    }
  > = {
    NEFT: {
      field: "neftNumber",
      label: "NEFT UTR Number",
      placeholder: "e.g. HDFC0000012345",
      hint: "22-character UTR number from your bank statement.",
    },
    UPI: {
      field: "upiTransactionId",
      label: "UPI Transaction ID",
      placeholder: "e.g. 4059876543210",
      hint: "12-digit transaction ID from the UPI app.",
    },
    RTGS: {
      field: "rtgsReference",
      label: "RTGS UTR Reference",
      placeholder: "e.g. RTGS2024050600001",
      hint: "UTR number provided by the bank for RTGS transfer.",
    },
    IMPS: {
      field: "impsReference",
      label: "IMPS Reference Number",
      placeholder: "e.g. 412210987654",
      hint: "12-digit reference from IMPS transfer confirmation.",
    },
    Card: {
      field: "cardReference",
      label: "Card Transaction / Approval ID",
      placeholder: "e.g. AUTH123456",
      hint: "Transaction or approval ID from the card terminal/statement.",
    },
  };
  const cfg = configs[mode];
  if (!cfg) return null;

  const value = (form[cfg.field] as string) || "";

  return (
    <Field label={cfg.label} required hint={cfg.hint}>
      <InputField
        icon={Hash}
        value={value}
        onChange={(v) => set(cfg.field, v)}
        placeholder={cfg.placeholder}
      />
    </Field>
  );
}
