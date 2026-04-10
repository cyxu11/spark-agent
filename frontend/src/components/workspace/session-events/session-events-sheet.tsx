"use client";

import { ActivityIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchThreadRuns } from "@/core/run-events/api";
import { useEventLog } from "@/core/run-events/use-event-log";

import { EventLogList } from "./event-log-list";

interface RunInfo {
  run_id: string;
  is_live?: boolean;
}

interface SessionEventsSheetProps {
  threadId: string;
  runs: RunInfo[];
}

export function SessionEventsSheet({ threadId, runs }: SessionEventsSheetProps) {
  const [open, setOpen] = useState(false);
  // Merged list: prop runs (live) + fetched historical runs
  const [allRuns, setAllRuns] = useState<RunInfo[]>(runs);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    runs[runs.length - 1]?.run_id ?? null,
  );

  // When the sheet opens, fetch historical runs from the DB
  useEffect(() => {
    if (!open || !threadId) return;
    fetchThreadRuns(threadId)
      .then(({ runs: fetched }) => {
        if (!fetched?.length) return; // 没有历史数据时保留当前状态
        setAllRuns((prev) => {
          const liveMap = new Map(prev.filter((r) => r.is_live).map((r) => [r.run_id, r]));
          const fetchedIds = new Set(fetched.map((r) => r.run_id));
          // 以 DB 历史记录为基础，overlay live 状态
          const merged = fetched.map((r) => liveMap.get(r.run_id) ?? { run_id: r.run_id });
          // 把所有 prev runs（不论 live 与否）中不在 DB 里的都追加进来
          for (const prevRun of prev) {
            if (!fetchedIds.has(prevRun.run_id)) merged.push(prevRun);
          }
          return merged;
        });
        // 如果当前没有选中的 run，或选中的 run 不在历史列表里，切换到最新的历史 run
        setSelectedRunId((cur) => {
          const fetchedIds = new Set(fetched.map((r) => r.run_id));
          if (!cur || !fetchedIds.has(cur)) {
            return fetched[fetched.length - 1]?.run_id ?? cur;
          }
          return cur;
        });
      })
      .catch(() => {/* keep existing */});
  }, [open, threadId]);

  // Sync allRuns when live prop runs change (new run started)
  useEffect(() => {
    if (runs.length === 0) return;
    setAllRuns((prev) => {
      const ids = new Set(prev.map((r) => r.run_id));
      const merged = prev.map((r) => {
        const live = runs.find((lr) => lr.run_id === r.run_id);
        return live ? { ...r, is_live: live.is_live } : r;
      });
      runs.forEach((r) => {
        if (!ids.has(r.run_id)) merged.push(r);
      });
      return merged;
    });
    const latest = runs[runs.length - 1]?.run_id;
    if (latest) setSelectedRunId(latest);
  }, [runs]);

  const isLive = allRuns.find((r) => r.run_id === selectedRunId)?.is_live ?? false;
  const { events, isLoading } = useEventLog(threadId, selectedRunId, isLive);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" title="Session Events">
          <ActivityIcon className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[480px] flex-col gap-0 p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-medium">Session Events</SheetTitle>
        </SheetHeader>

        {allRuns.length > 1 ? (
          <Tabs
            value={selectedRunId ?? undefined}
            onValueChange={setSelectedRunId}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="mx-4 mt-3 mb-1 h-8">
              {allRuns.map((r, i) => (
                <TabsTrigger key={r.run_id} value={r.run_id} className="text-xs">
                  Run {i + 1}
                  {r.is_live && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {allRuns.map((r) => (
              <TabsContent
                key={r.run_id}
                value={r.run_id}
                className="m-0 flex-1 overflow-hidden"
              >
                <EventLogList
                  events={events}
                  isLoading={isLoading}
                  isLive={r.is_live ?? false}
                />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className="flex-1 overflow-hidden">
            <EventLogList events={events} isLoading={isLoading} isLive={isLive} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
