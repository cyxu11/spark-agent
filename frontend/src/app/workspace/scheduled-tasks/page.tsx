import { ScheduledTaskList } from "@/components/workspace/scheduled-tasks/task-list";

export default function ScheduledTasksPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold">定时任务</h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ScheduledTaskList />
      </div>
    </div>
  );
}
