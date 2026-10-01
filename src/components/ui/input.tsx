import * as React from "react";

import { cn } from "@/lib/utils";
import { DateInput, DateTimeInput, MonthInput, type DateInputProps } from "@/components/ui/date-input";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    if (type === "date") {
      return <DateInput ref={ref} className={cn("h-10", className)} {...(props as DateInputProps)} />;
    }
    if (type === "month") {
      return <MonthInput ref={ref} className={cn("h-10", className)} {...(props as DateInputProps)} />;
    }
    if (type === "datetime-local") {
      return <DateTimeInput ref={ref} className={cn("h-10", className)} {...(props as DateInputProps)} />;
    }
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
