"use client";

import { HistoryIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function H5Header({
  title,
  onOpenHistory,
}: {
  title?: React.ReactNode;
  onOpenHistory: () => void;
}) {
  const { t } = useI18n();
  return (
    <header
      className={cn(
        "bg-background/80 supports-[backdrop-filter]:bg-background/60",
        "flex h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center truncate text-sm font-medium">
        {title}
      </div>
      <div className="flex items-center gap-1">
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t.sidebar.newChat}
        >
          <Link href="/h5/chats/new">
            <PlusIcon className="size-5" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t.sidebar.chats}
          onClick={onOpenHistory}
        >
          <HistoryIcon className="size-5" />
        </Button>
      </div>
    </header>
  );
}
