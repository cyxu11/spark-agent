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
import { useEventLog } from "@/core/run-events/use-event-log";

import { EventLogList } from "./event-log-list";

interface SessionEventsSheetProps {
  threadId: string;
  runs: Array<{ run_id: string; is_live?: boolean }>;
}

export function SessionEventsSheet({ threadId, runs }: SessionEventsSheetProps) {
  const [open, setOpen] = useState(false);
  const latestRun = runs[runs.length - 1];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    latestRun?.run_id ?? null,
  );

  useEffect(() => {
    const latest = runs[runs.length - 1]?.run_id ?? null;
    if (latest) setSelectedRunId(latest);
  }, [runs]);

  const isLive = runs.find((r) => r.run_id === selectedRunId)?.is_live ?? false;
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

        {runs.length > 1 ? (
          <Tabs
            value={selectedRunId ?? undefined}
            onValueChange={setSelectedRunId}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="mx-4 mt-3 mb-1 h-8">
              {runs.map((r, i) => (
                <TabsTrigger key={r.run_id} value={r.run_id} className="text-xs">
                  Run {i + 1}
                  {r.is_live && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {runs.map((r) => (
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
