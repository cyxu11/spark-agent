"use client";

import { useEffect, useRef, useState } from "react";

import { fetchRunEvents, createRunEventSource } from "./api";
import { type RunEvent } from "./types";

export function useEventLog(
  threadId: string,
  runId: string | null,
  isLiveRun = false,
) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }
    setIsLoading(true);
    setEvents([]);

    fetchRunEvents(threadId, runId)
      .then(({ events: initial, next_after_id }) => {
        setEvents(initial);
        setIsLoading(false);

        if (isLiveRun) {
          const es = createRunEventSource(threadId, runId, next_after_id);
          esRef.current = es;
          es.onmessage = (e: MessageEvent) => {
            try {
              const ev: RunEvent = JSON.parse(e.data as string);
              setEvents((prev) => [...prev, ev]);
            } catch {
              // ignore parse errors
            }
          };
          es.onerror = () => es.close();
        }
      })
      .catch(() => setIsLoading(false));

    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [threadId, runId, isLiveRun]);

  return { events, isLoading };
}
