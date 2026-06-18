import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent } from "@/components/ui/card";
import { ShoppingCart } from "lucide-react";

export default function SaleOrder() {
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Sales Module", "Sale Order"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Sale Order
      </h1>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShoppingCart size={22} />
          </span>
          <p className="text-foreground font-semibold">
            Sale Order — coming soon
          </p>
          <p className="text-sm text-muted-foreground max-w-sm">
            This page is a stub. Sale order creation, listing, and approval
            workflow will be built out here.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
