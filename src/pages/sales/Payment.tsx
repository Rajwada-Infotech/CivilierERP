import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { CreditCard } from "lucide-react";

export default function Payment() {
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Module", "Payment"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Payment
      </h1>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CreditCard size={22} />
          </span>
          <p className="text-foreground font-semibold">
            Payment — coming soon
          </p>
          <p className="text-sm text-muted-foreground max-w-sm">
            This page is a stub. Payment collection, receipts, and history
            for sale orders will be built out here.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
