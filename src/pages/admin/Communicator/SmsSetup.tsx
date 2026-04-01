import React from "react";
import { MessageSquare } from "lucide-react";

const SmsSetup: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-muted-foreground">
      <MessageSquare size={40} className="opacity-30" />
      <p className="text-lg font-heading font-semibold">SMS Setup</p>
      <p className="text-sm">SMS configuration coming soon.</p>
    </div>
  );
};

export default SmsSetup;
