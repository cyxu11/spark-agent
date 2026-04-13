"use client";

import {
  Tooltip as TooltipPrimitive,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function Tooltip({
  children,
  content,
  side,
  ...props
}: {
  children: React.ReactNode;
  content?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive delayDuration={500} {...props}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </TooltipPrimitive>
  );
}
