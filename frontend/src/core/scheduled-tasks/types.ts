export interface TaskConfig {
  id: string;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  created_at: string;
  last_run_at: string | null;
}

export interface RunRecord {
  run_id: string;
  exit_code: number;
  duration_seconds: number;
  output_dir: string;
}

export interface TaskDetail {
  task: TaskConfig;
  last_run: RunRecord | null;
  script_content: string;
}

export interface OutputFileItem {
  name: string;
  size: number;
}

export interface CreateTaskPayload {
  name: string;
  description: string;
  cron: string;
  script_content: string;
}
