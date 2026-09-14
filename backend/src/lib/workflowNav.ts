import { toast } from "sonner";
import type { NavigateFunction } from "react-router-dom";

// Shared "next step unlocked" prompt for the CRM workflow — a toast with a
// jump-to button, not a forced redirect, so staff mid-review of something
// else aren't yanked away. Mirrors the existing Brokerage -> Broker Payment
// "Record Payment" button pattern in CrmBrokerage.tsx.
export function promptNextStep(navigate: NavigateFunction, message: string, path: string, label: string) {
  toast.success(message, {
    duration: 8000,
    action: { label, onClick: () => navigate(path) },
  });
}
