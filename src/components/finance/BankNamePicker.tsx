import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

// A grouped picker of common Indian banks (Major/Other), with a free-text
// "Other" fallback for anything not listed — originally built for Received
// Payment's "Customer Bank Name" field (a free-text field that used to let
// entries drift across spellings of the same bank), reused wherever a bank
// needs to be identified by NAME alone rather than by one of our own
// registered accounts — e.g. Loan Sanction's Bank Loan lender, which can be
// any bank, not necessarily one we already hold an account with.

export const MAJOR_BANKS = [
  "State Bank of India",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "Punjab National Bank",
  "Bank of Baroda",
  "Canara Bank",
  "Union Bank of India",
  "IndusInd Bank",
  "IDBI Bank",
  "Yes Bank",
  "Bank of India",
  "Indian Bank",
  "Central Bank of India",
];

export const MINOR_BANKS = [
  "IDFC FIRST Bank",
  "Federal Bank",
  "South Indian Bank",
  "Karnataka Bank",
  "RBL Bank",
  "Bandhan Bank",
  "City Union Bank",
  "DCB Bank",
  "Karur Vysya Bank",
  "Tamilnad Mercantile Bank",
  "Bank of Maharashtra",
  "UCO Bank",
  "Punjab & Sind Bank",
  "AU Small Finance Bank",
  "Equitas Small Finance Bank",
  "Ujjivan Small Finance Bank",
];

export const OTHER_BANK_VALUE = "__other__";

export function BankNamePicker({
  value,
  onChange,
  placeholder = "Select bank…",
  otherPlaceholder = "Bank name",
  className,
}: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  otherPlaceholder?: string;
  className?: string;
}) {
  // Starts in "Other" mode whenever the current value isn't one of the
  // listed banks (including empty, so a freshly-typed name doesn't get
  // silently reset to the dropdown's placeholder on every keystroke).
  const [customBank, setCustomBank] = useState(
    () => !!value && !MAJOR_BANKS.includes(value) && !MINOR_BANKS.includes(value),
  );

  return (
    <div className="space-y-1.5">
      <Select
        value={
          customBank
            ? OTHER_BANK_VALUE
            : MAJOR_BANKS.includes(value) || MINOR_BANKS.includes(value)
              ? value
              : ""
        }
        onValueChange={(v) => {
          if (v === OTHER_BANK_VALUE) {
            setCustomBank(true);
            onChange("");
          } else {
            setCustomBank(false);
            onChange(v);
          }
        }}
      >
        <SelectTrigger className={className ?? "h-9 text-sm"}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Major Banks</SelectLabel>
            {MAJOR_BANKS.map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Other Banks</SelectLabel>
            {MINOR_BANKS.map((b) => (
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectGroup>
          <SelectItem value={OTHER_BANK_VALUE}>Other (type below)</SelectItem>
        </SelectContent>
      </Select>
      {customBank && (
        <Input
          className="h-9 text-sm"
          placeholder={otherPlaceholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      )}
    </div>
  );
}
