"use client";

import type { Message } from "@langchain/langgraph-sdk";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { createTask } from "@/core/scheduled-tasks";

interface TaskPreview {
  __scheduled_task_preview__: true;
  name: string;
  description: string;
  cron: string;
  script_content: string;
}

function parseCronHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];
  if (dom === "*" && month === "*" && dow === "*" && min !== "*" && hour !== "*") {
    return `每天 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }
  return cron;
}

function parsePreview(message: Message): TaskPreview | null {
  try {
    const raw = typeof message.content === "string" ? message.content : "{}";
    const data = JSON.parse(raw) as TaskPreview;
    return data.__scheduled_task_preview__ === true ? data : null;
  } catch {
    return null;
  }
}

export function ScheduledTaskPreviewCard({ message }: { message: Message }) {
  const { t } = useI18n();
  const preview = parsePreview(message);
  const [name, setName] = useState(preview?.name ?? "");
  const [cron, setCron] = useState(preview?.cron ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!preview) return null;

  const confirm = async () => {
    setError(null);
    try {
      await createTask({
        name,
        description: preview.description,
        cron,
        script_content: preview.script_content,
      });
      setConfirmed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task");
    }
  };

  if (confirmed) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        ✓ {t.scheduledTasks.title}「{name}」已创建
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t.scheduledTasks.createTaskTool}</span>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">任务名称</label>
        <input
          className="rounded border bg-background px-2 py-1 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-xs text-muted-foreground">{t.scheduledTasks.cronLabel}</label>
        <div className="flex items-center gap-2">
          <input
            className="w-40 rounded border bg-background px-2 py-1 font-mono text-sm"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
          />
          <Badge variant="outline" className="text-xs">
            {parseCronHuman(cron)}
          </Badge>
        </div>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {t.scheduledTasks.scriptPreview}
        </summary>
        <pre className="mt-2 max-h-48 overflow-x-auto rounded bg-muted p-2 text-xs">
          {preview.script_content}
        </pre>
      </details>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled>
          {t.scheduledTasks.cancel}
        </Button>
        <Button size="sm" onClick={() => void confirm()}>
          {t.scheduledTasks.confirmCreate}
        </Button>
      </div>
    </div>
  );
}
