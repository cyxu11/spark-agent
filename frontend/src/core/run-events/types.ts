export interface RunEvent {
  id: number;
  run_id: string;
  thread_id: string;
  event: string;
  data: unknown;
  seq: string;
  created_at: string;
}

export interface EventsResponse {
  events: RunEvent[];
  next_after_id: number;
}
