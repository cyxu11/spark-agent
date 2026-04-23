import { ScheduledTaskDetail } from "@/components/workspace/scheduled-tasks/task-detail";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ task_id: string }>;
}) {
  const { task_id } = await params;
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ScheduledTaskDetail taskId={task_id} />
    </div>
  );
}
