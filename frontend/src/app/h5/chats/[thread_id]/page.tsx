"use client";

import { useCallback, useEffect, useState } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { H5Header } from "@/components/h5/h5-header";
import { H5HistoryDrawer } from "@/components/h5/h5-history-drawer";
import { H5InputBox } from "@/components/h5/h5-input-box";
import {
  useSpecificChatMode,
  useThreadChat,
} from "@/components/workspace/chats";
import {
  MessageList,
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
  MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM,
} from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import { useI18n } from "@/core/i18n/hooks";
import { useNotification } from "@/core/notification/hooks";
import { useThreadSettings } from "@/core/settings";
import { useThreadStream } from "@/core/threads/hooks";
import { textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export default function H5ChatPage() {
  const { t } = useI18n();
  const [showFollowups, setShowFollowups] = useState(false);
  const { threadId, setThreadId, isNewThread, setIsNewThread, isMock } =
    useThreadChat();
  const [settings, setSettings] = useThreadSettings(threadId);
  const [mounted, setMounted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  useSpecificChatMode();

  useEffect(() => {
    setMounted(true);
  }, []);

  const { showNotification } = useNotification();

  const [thread, sendMessage, isUploading] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: settings.context,
    isMock,
    onStart: (createdThreadId) => {
      setThreadId(createdThreadId);
      setIsNewThread(false);
      // history.replaceState avoids next-router remount (matches workspace impl).
      history.replaceState(null, "", `/h5/chats/${createdThreadId}`);
    },
    onFinish: (state) => {
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages.at(-1);
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            body =
              textContent.length > 200
                ? textContent.substring(0, 200) + "..."
                : textContent;
          }
        }
        showNotification(state.title, { body });
      }
    },
  });

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (isNewThread) setIsNewThread(false);
      void sendMessage(threadId, message);
    },
    [sendMessage, threadId, isNewThread, setIsNewThread],
  );

  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  const messageListPaddingBottom = showFollowups
    ? MESSAGE_LIST_DEFAULT_PADDING_BOTTOM +
      MESSAGE_LIST_FOLLOWUPS_EXTRA_PADDING_BOTTOM
    : undefined;

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <H5Header
          title={
            !isNewThread ? (
              <ThreadTitle threadId={threadId} thread={thread} />
            ) : undefined
          }
          onOpenHistory={() => setHistoryOpen(true)}
        />
        <main className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 justify-center">
            <MessageList
              className="size-full"
              threadId={threadId}
              thread={thread}
              paddingBottom={messageListPaddingBottom}
            />
          </div>
          <div className="absolute right-0 bottom-0 left-0 z-30 flex flex-col">
            <div className="relative">
              <div className="absolute -top-4 right-0 left-0 z-0 px-3">
                <TodoList
                  className="bg-background/5"
                  todos={thread.values.todos ?? []}
                  hidden={
                    !thread.values.todos || thread.values.todos.length === 0
                  }
                />
              </div>
              {mounted ? (
                <H5InputBox
                  isNewThread={isNewThread}
                  threadId={threadId}
                  autoFocus={false}
                  status={
                    thread.error
                      ? "error"
                      : thread.isLoading
                        ? "streaming"
                        : "ready"
                  }
                  context={settings.context}
                  extraHeader={
                    isNewThread && <Welcome mode={settings.context.mode} />
                  }
                  disabled={
                    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ||
                    isUploading
                  }
                  onContextChange={(context) =>
                    setSettings("context", context)
                  }
                  onFollowupsVisibilityChange={setShowFollowups}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                />
              ) : (
                <div
                  aria-hidden="true"
                  className={cn(
                    "bg-background/5 mx-3 h-32 rounded-2xl border",
                    "mb-[max(0.5rem,env(safe-area-inset-bottom))]",
                  )}
                />
              )}
              {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                <div className="text-muted-foreground/67 w-full pb-2 text-center text-xs">
                  {t.common.notAvailableInDemoMode}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
      <H5HistoryDrawer open={historyOpen} onOpenChange={setHistoryOpen} />
    </ThreadContext.Provider>
  );
}
