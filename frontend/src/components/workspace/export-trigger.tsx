"use client";

import { Download, FileCode2, FileJson, FileText } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import {
  exportThreadAsHTML,
  exportThreadAsJSON,
  exportThreadAsMarkdown,
} from "@/core/threads/export";
import type { AgentThread } from "@/core/threads/types";

import { useThread } from "./messages/context";
import { Tooltip } from "./tooltip";

export function ExportTrigger({ threadId }: { threadId: string }) {
  const { t } = useI18n();
  const { thread } = useThread();

  const messages = thread.messages;

  const handleExport = useCallback(
    async (format: "markdown" | "json" | "html") => {
      if (messages.length === 0) {
        toast.error(t.conversation.noMessages);
        return;
      }
      const agentThread = {
        thread_id: threadId,
        updated_at: new Date().toISOString(),
        values: thread.values,
      } as AgentThread;

      if (format === "markdown") {
        exportThreadAsMarkdown(agentThread, messages);
        toast.success(t.common.exportSuccess);
      } else if (format === "json") {
        exportThreadAsJSON(agentThread, messages);
        toast.success(t.common.exportSuccess);
      } else {
        const shareUrl = await exportThreadAsHTML(agentThread, messages);
        if (shareUrl) {
          try {
            await navigator.clipboard.writeText(shareUrl);
            toast.success(t.common.exportHtmlShared, {
              description: shareUrl,
              action: {
                label: t.common.openShare,
                onClick: () => window.open(shareUrl, "_blank"),
              },
              duration: 8000,
            });
          } catch {
            toast.success(t.common.exportHtmlShared, {
              description: shareUrl,
              duration: 8000,
            });
          }
        } else {
          toast.success(t.common.exportSuccess);
        }
      }
    },
    [messages, thread.values, threadId, t],
  );

  if (messages.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <Tooltip content={t.common.export}>
        <DropdownMenuTrigger asChild>
          <Button
            className="text-muted-foreground hover:text-foreground"
            variant="ghost"
          >
            <Download />
            {t.common.export}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void handleExport("html")}>
          <FileCode2 className="text-muted-foreground" />
          <span>{t.common.exportAsHTML}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleExport("markdown")}>
          <FileText className="text-muted-foreground" />
          <span>{t.common.exportAsMarkdown}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleExport("json")}>
          <FileJson className="text-muted-foreground" />
          <span>{t.common.exportAsJSON}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
