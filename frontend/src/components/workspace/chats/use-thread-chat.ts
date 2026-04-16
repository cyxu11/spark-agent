"use client";

import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { uuid } from "@/core/utils/uuid";

export function useThreadChat() {
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const pathname = usePathname();

  const searchParams = useSearchParams();
  const [threadId, setThreadId] = useState(() => {
    return threadIdFromPath === "new" ? uuid() : threadIdFromPath;
  });

  const [isNewThread, setIsNewThread] = useState(
    () => threadIdFromPath === "new",
  );

  // Track if isNewThread was manually set to false (e.g., by onStart callback)
  const [manuallySetNotNew, setManuallySetNotNew] = useState(false);

  useEffect(() => {
    if (pathname.endsWith("/new")) {
      setIsNewThread(true);
      setManuallySetNotNew(false);
      setThreadId(uuid());
      return;
    }
    // Guard: after history.replaceState updates the URL from /chats/new to
    // /chats/{UUID}, Next.js useParams may still return the stale "new" value
    // because replaceState does not trigger router updates.  Avoid propagating
    // this invalid thread ID to downstream hooks (e.g. useStream), which would
    // cause a 422 from LangGraph Server.
    if (threadIdFromPath === "new") {
      return;
    }
    // Don't override if manually set to false
    if (!manuallySetNotNew) {
      setIsNewThread(false);
      setThreadId(threadIdFromPath);
    }
  }, [pathname, threadIdFromPath, manuallySetNotNew]);

  const isMock = searchParams.get("mock") === "true";

  // Wrap setIsNewThread to track manual changes
  const wrappedSetIsNewThread = (value: boolean | ((prev: boolean) => boolean)) => {
    setIsNewThread(value);
    const newValue = typeof value === "function" ? value(isNewThread) : value;
    if (!newValue) {
      setManuallySetNotNew(true);
    }
  };

  return { threadId, setThreadId, isNewThread, setIsNewThread: wrappedSetIsNewThread, isMock };
}
