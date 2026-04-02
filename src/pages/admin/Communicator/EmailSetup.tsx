import React from "react";
import { Mail } from "lucide-react";

const EmailSetup: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-muted-foreground">
      <Mail size={40} className="opacity-30" />
      <p className="text-lg font-heading font-semibold">Email Setup</p>
      <p className="text-sm">Email configuration coming soon.</p>
    </div>
  );
};

export default EmailSetup;
