"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { type RunEvent } from "@/core/run-events/types";
import { cn } from "@/lib/utils";

const EVENT_COLORS: Record<string, string> = {
  "messages-tuple": "bg-blue-500/10 text-blue-600 border-blue-200",
  values: "bg-green-500/10 text-green-600 border-green-200",
  updates: "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  metadata: "bg-purple-500/10 text-purple-600 border-purple-200",
  error: "bg-red-500/10 text-red-600 border-red-200",
  __end__: "bg-gray-500/10 text-gray-600 border-gray-200",
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function EventItem({ event }: { event: RunEvent }) {
  const [open, setOpen] = useState(false);
  const badgeClass = EVENT_COLORS[event.event] ?? "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Badge variant="outline" className={cn("font-mono text-xs", badgeClass)}>
          {event.event}
        </Badge>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {formatTime(event.created_at)}
        </span>
      </button>
      {open && (
        <pre className="mx-3 mb-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs leading-relaxed">
          {JSON.stringify(event.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
