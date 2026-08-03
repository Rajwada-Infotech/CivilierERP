import React from "react";
import { GlassShell } from "@/components/dashboard/GlassShell";
import { MoneyRecive } from "iconsax-react";
import { Sparkles } from "lucide-react";

const ACCENT = "#22c55e";

export default function LoanDashboard() {
  return (
    <GlassShell
      title="Loan"
      subtitle="Loan management workspace"
      icon={MoneyRecive}
      accentColor={ACCENT}
    >
      <div className="flex flex-col items-center justify-center text-center py-24 px-6">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}30` }}
        >
          <Sparkles size={26} style={{ color: ACCENT }} />
        </div>
        <h2 className="text-lg font-heading font-semibold text-foreground mb-1.5">
          Loan module coming soon
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          This is a placeholder — loan origination, tracking and repayment
          schedules will land here.
        </p>
      </div>
    </GlassShell>
  );
}
