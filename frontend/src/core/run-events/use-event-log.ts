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
  const afterIdRef = useRef<number>(0);

  // Effect 1: fetch persisted events whenever the run changes
  useEffect(() => {
    if (!runId) {
      setEvents([]);
      afterIdRef.current = 0;
      return;
    }

    setIsLoading(true);
    setEvents([]);
    afterIdRef.current = 0;

    fetchRunEvents(threadId, runId)
      .then(({ events: initial, next_after_id }) => {
        setEvents(initial);
        afterIdRef.current = next_after_id;
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));

    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [threadId, runId]);

  // Effect 2: open/close SSE subscription based on isLiveRun — never clears existing events
  useEffect(() => {
    if (!isLiveRun || !runId) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const es = createRunEventSource(threadId, runId, afterIdRef.current);
    esRef.current = es;

    es.onmessage = (e: MessageEvent) => {
      try {
        const ev: RunEvent = JSON.parse(e.data as string);
        setEvents((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].id >= ev.id) return prev;
          return [...prev, ev];
        });
        afterIdRef.current = ev.id;
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => es.close();

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [threadId, runId, isLiveRun]);

  return { events, isLoading };
}
