"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/core/i18n/hooks";
import { useDeleteThread, useThreads } from "@/core/threads/hooks";
import type { AgentThread } from "@/core/threads/types";
import { titleOfThread } from "@/core/threads/utils";
import { formatTimeAgo } from "@/core/utils/datetime";

import { pathOfH5Thread } from "./utils";

type ThreadStatus = AgentThread["status"];

function statusVariant(
  status: ThreadStatus | undefined,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "busy":
      return "default";
    case "error":
      return "destructive";
    case "interrupted":
      return "outline";
    case "idle":
    default:
      return "secondary";
  }
}

export function H5HistoryDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { data: threads } = useThreads();
  const { mutateAsync: deleteThread, isPending: isDeleting } =
    useDeleteThread();
  const [search, setSearch] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filteredThreads = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return threads;
    return threads?.filter((thread) =>
      titleOfThread(thread).toLowerCase().includes(keyword),
    );
  }, [threads, search]);

  const statusLabel = (status: ThreadStatus | undefined): string => {
    switch (status) {
      case "idle":
        return t.chats.status.idle;
      case "busy":
        return t.chats.status.busy;
      case "interrupted":
        return t.chats.status.interrupted;
      case "error":
        return t.chats.status.error;
      default:
        return t.chats.status.unknown;
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await deleteThread({ threadId: id });
      toast.success(t.chats.deleteSuccess);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.chats.deleteFailed;
      toast.error(msg);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-[90vw] max-w-md flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="shrink-0 border-b px-4 py-3">
            <SheetTitle className="text-base">{t.sidebar.chats}</SheetTitle>
          </SheetHeader>
          <div className="shrink-0 px-4 py-3">
            <Input
              type="search"
              className="h-10"
              placeholder={t.chats.searchChats}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1">
            <ScrollArea className="size-full">
              <div className="flex flex-col">
                {filteredThreads?.length === 0 && (
                  <div className="text-muted-foreground py-16 text-center text-sm">
                    {t.chats.empty}
                  </div>
                )}
                {filteredThreads?.map((thread) => (
                  <div
                    key={thread.thread_id}
                    className="hover:bg-muted/50 relative flex items-center gap-2 border-b px-4 py-3 transition-colors"
                  >
                    <Link
                      href={pathOfH5Thread(thread.thread_id)}
                      className="flex min-w-0 flex-1 flex-col gap-1"
                      onClick={() => onOpenChange(false)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {titleOfThread(thread)}
                        </span>
                        <Badge
                          variant={statusVariant(thread.status)}
                          className="shrink-0"
                        >
                          {statusLabel(thread.status)}
                        </Badge>
                      </div>
                      <div
                        className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                        suppressHydrationWarning
                      >
                        {thread.created_at && (
                          <span>
                            {t.chats.createdAt}·
                            {formatTimeAgo(thread.created_at)}
                          </span>
                        )}
                        {thread.updated_at && (
                          <span>{formatTimeAgo(thread.updated_at)}</span>
                        )}
                      </div>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive size-11 shrink-0"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setPendingDeleteId(thread.thread_id);
                      }}
                      aria-label={t.common.delete}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t.chats.deleteConfirmTitle}</DialogTitle>
            <DialogDescription>
              {t.chats.deleteConfirmDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDeleteId(null)}
              disabled={isDeleting}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {t.common.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
