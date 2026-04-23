"use client";

import { ClockIcon, PlayIcon, SquareIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import {
  deleteTask,
  listTasks,
  updateTask,
  type TaskConfig,
} from "@/core/scheduled-tasks";

export function ScheduledTaskList() {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<TaskConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await listTasks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = async (task: TaskConfig) => {
    await updateTask(task.id, { enabled: !task.enabled });
    await reload();
  };

  const remove = async (task: TaskConfig) => {
    if (!confirm(t.scheduledTasks.deleteConfirm)) return;
    await deleteTask(task.id);
    await reload();
  };

  if (loading) {
    return <div className="p-8 text-muted-foreground">{t.common.loading}</div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center text-muted-foreground">
        <ClockIcon className="size-10 opacity-40" />
        <p className="max-w-xs text-sm">{t.scheduledTasks.empty}</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {tasks.map((task) => (
        <div key={task.id} className="flex items-center gap-4 px-6 py-4">
          <div className="min-w-0 flex-1">
            <Link
              href={`/workspace/scheduled-tasks/${task.id}`}
              className="block truncate font-medium hover:underline"
            >
              {task.name}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {task.cron}
              {" · "}
              {t.scheduledTasks.lastRun}:{" "}
              {task.last_run_at
                ? new Date(task.last_run_at).toLocaleString()
                : t.scheduledTasks.never}
            </p>
          </div>
          <Badge variant={task.enabled ? "default" : "secondary"}>
            {task.enabled ? t.scheduledTasks.enabled : t.scheduledTasks.disabled}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void toggle(task)}
            title={task.enabled ? t.scheduledTasks.disabled : t.scheduledTasks.enabled}
          >
            {task.enabled ? (
              <SquareIcon className="size-4" />
            ) : (
              <PlayIcon className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void remove(task)}
            title={t.scheduledTasks.deleteTask}
          >
            <Trash2Icon className="size-4 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}
