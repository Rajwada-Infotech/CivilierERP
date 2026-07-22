import * as React from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/**
 * Message primitives, shaped after shadcn's `Message` component API
 * (Message / MessageAvatar / MessageContent) — adapted from its chatbot
 * "user"/"assistant" model to ours, where a thread can have any number of
 * named participants (staff, supplier, admin, engineer, ...). `from` takes
 * "mine" | "theirs" for alignment; `tone` drives the avatar color and is
 * derived from the participant's role by the caller.
 */

export type MessageProps = React.HTMLAttributes<HTMLDivElement> & {
  from: "mine" | "theirs";
};

export const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  ({ className, from, ...props }, ref) => (
    <div
      ref={ref}
      data-from={from}
      className={cn(
        "group flex gap-2",
        from === "mine" ? "flex-row-reverse" : "flex-row",
        className,
      )}
      {...props}
    />
  ),
);
Message.displayName = "Message";

export type MessageAvatarProps = {
  name: string;
  tone?: string;
  className?: string;
};

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export const MessageAvatar: React.FC<MessageAvatarProps> = ({
  name,
  tone = "bg-slate-500 text-white",
  className,
}) => (
  <Avatar className={cn("h-6 w-6 shrink-0", className)}>
    <AvatarFallback className={cn("text-[9px] font-bold", tone)}>
      {getInitials(name || "U")}
    </AvatarFallback>
  </Avatar>
);

export type MessageContentProps = React.HTMLAttributes<HTMLDivElement> & {
  pending?: boolean;
};

export const MessageContent = React.forwardRef<
  HTMLDivElement,
  MessageContentProps
>(({ className, pending, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "min-w-0 max-w-full rounded-2xl px-3 py-2 transition-opacity",
      "group-data-[from=mine]:rounded-tr-sm group-data-[from=mine]:bg-primary group-data-[from=mine]:text-primary-foreground",
      "group-data-[from=theirs]:rounded-tl-sm group-data-[from=theirs]:bg-muted group-data-[from=theirs]:text-foreground",
      pending && "opacity-60",
      className,
    )}
    {...props}
  >
    {children}
  </div>
));
MessageContent.displayName = "MessageContent";
