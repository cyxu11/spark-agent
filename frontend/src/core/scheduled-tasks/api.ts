import { getBackendBaseURL } from "@/core/config";

import type {
  CreateTaskPayload,
  OutputFileItem,
  RunRecord,
  TaskConfig,
  TaskDetail,
} from "./types";

const BASE = () => `${getBackendBaseURL()}/api/scheduled-tasks`;

export async function listTasks(): Promise<TaskConfig[]> {
  const res = await fetch(BASE());
  const json = await res.json();
  return (json as { tasks: TaskConfig[] }).tasks;
}

export async function createTask(payload: CreateTaskPayload): Promise<TaskConfig> {
  const res = await fetch(BASE(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<TaskConfig>;
}

export async function getTask(taskId: string): Promise<TaskDetail> {
  const res = await fetch(`${BASE()}/${taskId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<TaskDetail>;
}

export async function updateTask(
  taskId: string,
  patch: { enabled?: boolean; name?: string; cron?: string },
): Promise<TaskConfig> {
  const res = await fetch(`${BASE()}/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<TaskConfig>;
}

export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${BASE()}/${taskId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function listRuns(taskId: string): Promise<RunRecord[]> {
  const res = await fetch(`${BASE()}/${taskId}/outputs`);
  const json = await res.json();
  return (json as { runs: RunRecord[] }).runs;
}

export async function listRunFiles(
  taskId: string,
  runId: string,
): Promise<OutputFileItem[]> {
  const res = await fetch(`${BASE()}/${taskId}/outputs/${runId}`);
  const json = await res.json();
  return (json as { files: OutputFileItem[] }).files;
}

export function getDownloadUrl(taskId: string, runId: string, filename: string): string {
  return `${BASE()}/${taskId}/outputs/${runId}/${filename}`;
}
