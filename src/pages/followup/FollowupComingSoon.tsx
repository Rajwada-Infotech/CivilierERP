import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function FollowupComingSoon({ title = "Followup Module" }: { title?: string }) {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Card>
        <CardContent className="py-10">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="rounded-md bg-primary/10 p-3 text-primary">
                <Clock3 className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold">{title}</h1>
                <p className="mt-1 text-muted-foreground">
                  This followup area is reserved for the next workflow stage. The active sales pipeline pages are available now.
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate("/followup")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
