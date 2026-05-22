import { DashboardBackground } from "@/components/DashboardBackground";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, Plus } from "lucide-react";

export default function BookingsPage() {
  return (
    <DashboardBackground>
      <div className="p-6 space-y-6">
        <Breadcrumbs
          items={[
            { label: "Followup" },
            { label: "Sales" },
            { label: "Bookings" },
          ]}
        />

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage unit bookings and booking agreements
            </p>
          </div>
          <Button disabled>
            <Plus className="h-4 w-4 mr-2" />
            New Booking
          </Button>
        </div>

        <Card>
          <CardContent className="flex flex-col items-center justify-center py-24 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground">
              Bookings — Coming Soon
            </h3>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-xs">
              This page is under construction. Booking management will be
              available here shortly.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardBackground>
  );
}
