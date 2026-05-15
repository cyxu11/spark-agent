"use client";

import type { ComponentProps } from "react";

import { InputBox } from "@/components/workspace/input-box";
import { cn } from "@/lib/utils";

export function H5InputBox({
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof InputBox> & {
  containerClassName?: string;
}) {
  return (
    <div
      className={cn(
        "w-full px-3",
        "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
        containerClassName,
      )}
    >
      <InputBox
        {...props}
        className={cn("bg-background/80 w-full backdrop-blur", className)}
      />
    </div>
  );
}
