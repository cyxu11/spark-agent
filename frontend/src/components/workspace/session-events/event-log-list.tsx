"use client";

import { useEffect, useRef } from "react";

import { type RunEvent } from "@/core/run-events/types";

import { EventItem } from "./event-item";
import { mergeMessageEvents } from "./merge-events";

interface EventLogListProps {
  events: RunEvent[];
  isLoading: boolean;
  isLive: boolean;
}

export function EventLogList({ events, isLoading, isLive }: EventLogListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isLive) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [events.length, isLive]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading events…
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No events recorded for this run.
      </div>
    );
  }

  const processed = mergeMessageEvents(events);

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div className="divide-y divide-border/50">
        {processed.map((ev) => (
          <EventItem key={ev.id} event={ev} />
        ))}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
