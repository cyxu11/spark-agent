import { type EventsResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "";

export async function fetchRunEvents(
  threadId: string,
  runId: string,
  afterId = 0,
  eventTypes?: string[],
): Promise<EventsResponse> {
  const params = new URLSearchParams({ after_id: String(afterId), limit: "200" });
  if (eventTypes?.length) {
    eventTypes.forEach((t) => params.append("event_type", t));
  }
  const res = await fetch(
    `${BASE}/api/threads/${threadId}/runs/${runId}/events?${params}`,
  );
  if (!res.ok) throw new Error(`fetchRunEvents: ${res.status}`);
  return res.json() as Promise<EventsResponse>;
}

export function createRunEventSource(
  threadId: string,
  runId: string,
  afterId = 0,
): EventSource {
  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? "";
  return new EventSource(
    `${BASE_URL}/api/threads/${threadId}/runs/${runId}/events/stream?after_id=${afterId}`,
  );
}
