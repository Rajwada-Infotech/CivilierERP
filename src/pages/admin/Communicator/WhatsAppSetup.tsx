import React from "react";
import { MessageCircle } from "lucide-react";

const WhatsAppSetup: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-muted-foreground">
      <MessageCircle size={40} className="opacity-30" />
      <p className="text-lg font-heading font-semibold">WhatsApp Setup</p>
      <p className="text-sm">WhatsApp configuration coming soon.</p>
    </div>
  );
};

export default WhatsAppSetup;
