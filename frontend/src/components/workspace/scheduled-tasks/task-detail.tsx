"use client";

import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  getDownloadUrl,
  getTask,
  listRunFiles,
  type OutputFileItem,
  type TaskDetail,
} from "@/core/scheduled-tasks";

export function ScheduledTaskDetail({ taskId }: { taskId: string }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [files, setFiles] = useState<OutputFileItem[]>([]);

  useEffect(() => {
    getTask(taskId).then(setDetail).catch(console.error);
  }, [taskId]);

  useEffect(() => {
    if (!selectedRun) return;
    listRunFiles(taskId, selectedRun).then(setFiles).catch(console.error);
  }, [taskId, selectedRun]);

  if (!detail) {
    return <div className="p-8 text-muted-foreground">{t.common.loading}</div>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">{detail.task.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{detail.task.description}</p>
        <div className="mt-2 flex gap-2">
          <Badge variant="outline">{detail.task.cron}</Badge>
          <Badge variant={detail.task.enabled ? "default" : "secondary"}>
            {detail.task.enabled ? t.scheduledTasks.enabled : t.scheduledTasks.disabled}
          </Badge>
        </div>
      </div>

      {detail.script_content && (
        <div>
          <h3 className="mb-2 text-sm font-medium">{t.scheduledTasks.scriptPreview}</h3>
          <pre className="max-h-64 overflow-x-auto rounded bg-muted p-3 text-xs">
            {detail.script_content}
          </pre>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium">{t.scheduledTasks.outputs}</h3>
        {detail.last_run ? (
          <div className="space-y-2">
            <button
              className="w-full rounded border p-3 text-left text-sm hover:bg-muted/50"
              onClick={() =>
                setSelectedRun(
                  selectedRun === detail.last_run?.run_id
                    ? null
                    : (detail.last_run?.run_id ?? null),
                )
              }
            >
              <span className="font-mono">{detail.last_run.run_id}</span>
              {" · "}
              <Badge
                variant={detail.last_run.exit_code === 0 ? "default" : "destructive"}
                className="text-xs"
              >
                {detail.last_run.exit_code === 0
                  ? t.scheduledTasks.status.success
                  : t.scheduledTasks.status.failed}
              </Badge>
              {" · "}
              {detail.last_run.duration_seconds}s
            </button>
            {selectedRun === detail.last_run.run_id && (
              <div className="space-y-1 rounded border p-3">
                {files.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t.scheduledTasks.noOutputs}</p>
                ) : (
                  files.map((f) => (
                    <div key={f.name} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-xs">{f.name}</span>
                      <a href={getDownloadUrl(taskId, selectedRun, f.name)} download={f.name}>
                        <Button variant="ghost" size="sm">
                          <DownloadIcon className="mr-1 size-3" />
                          {t.scheduledTasks.download}
                        </Button>
                      </a>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.scheduledTasks.noOutputs}</p>
        )}
      </div>
    </div>
  );
}
