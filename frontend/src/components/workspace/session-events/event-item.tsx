"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { type RunEvent } from "@/core/run-events/types";
import { cn } from "@/lib/utils";

import { type ProcessedEvent } from "./merge-events";

const EVENT_COLORS: Record<string, string> = {
  "messages-tuple": "bg-blue-500/10 text-blue-600 border-blue-200",
  messages: "bg-blue-500/10 text-blue-600 border-blue-200",
  values: "bg-green-500/10 text-green-600 border-green-200",
  updates: "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  metadata: "bg-purple-500/10 text-purple-600 border-purple-200",
  error: "bg-red-500/10 text-red-600 border-red-200",
  __end__: "bg-gray-500/10 text-gray-600 border-gray-200",
};

function tryFormatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

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

/** 合并后的 messages 事件展示 */
function MergedMessageItem({ event }: { event: ProcessedEvent }) {
  const [open, setOpen] = useState(false);
  const { mergedContent = "", mergedToolCalls, chunkCount = 1 } = event;
  const hasContent = mergedContent.trim().length > 0;
  const hasToolCalls = mergedToolCalls && mergedToolCalls.length > 0;

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
        <Badge
          variant="outline"
          className={cn("font-mono text-xs shrink-0", EVENT_COLORS["messages"])}
        >
          messages
        </Badge>
        {/* 行内预览 */}
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {hasContent
            ? mergedContent
            : hasToolCalls
              ? mergedToolCalls!.map((tc) => `[${tc.name}]`).join(" ")
              : "—"}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground/60">
          ×{chunkCount}
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatTime(event.created_at)}
        </span>
      </button>

      {open && (
        <div className="mx-3 mb-2 space-y-1.5 overflow-hidden">
          {hasContent && (
            <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs leading-relaxed whitespace-pre">
              {mergedContent}
            </pre>
          )}
          {hasToolCalls && (
            <div className="space-y-1">
              {mergedToolCalls!.map((tc, i) => (
                <div key={i} className="overflow-x-auto rounded bg-yellow-50 border border-yellow-200 p-2 font-mono text-xs">
                  <div className="font-semibold text-yellow-800">{tc.name}</div>
                  {tc.args && (
                    <pre className="mt-1 text-yellow-700 whitespace-pre">
                      {tryFormatJson(tc.args)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function EventItem({ event }: { event: RunEvent | ProcessedEvent }) {
  const [open, setOpen] = useState(false);
  const processed = event as ProcessedEvent;

  // 合并后的 messages 事件走专用渲染
  if (event.event === "messages" && processed.chunkCount !== undefined) {
    return <MergedMessageItem event={processed} />;
  }

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
        <pre className="mx-3 mb-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs leading-relaxed whitespace-pre">
          {JSON.stringify(event.data, null, 2)}
        </pre>
      )}
    </div>
  );
}
