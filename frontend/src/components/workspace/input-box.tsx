"use client";

import type { ChatStatus } from "ai";
import {
  CheckIcon,
  LightbulbIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { ConfettiButton } from "@/components/ui/confetti-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { useSkills } from "@/core/skills/hooks";
import type { AgentThreadContext } from "@/core/threads";
import { textOfMessage } from "@/core/threads/utils";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "../ai-elements/model-selector";
import { Suggestion, Suggestions } from "../ai-elements/suggestion";
import { useThread } from "./messages/context";
import { ModeHoverGuide } from "./mode-hover-guide";
import { Tooltip } from "./tooltip";

type InputMode = "flash" | "thinking" | "pro" | "ultra";

function getResolvedMode(
  mode: InputMode | undefined,
  supportsThinking: boolean,
): InputMode {
  if (!supportsThinking && mode !== "flash") {
    return "flash";
  }
  if (mode) {
    return mode;
  }
  return supportsThinking ? "pro" : "flash";
}

export function InputBox({
  className,
  disabled,
  autoFocus,
  status = "ready",
  context,
  extraHeader,
  isNewThread,
  threadId,
  initialValue,
  onContextChange,
  onFollowupsVisibilityChange,
  onSubmit,
  onStop,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
  assistantId?: string | null;
  status?: ChatStatus;
  disabled?: boolean;
  context: Omit<
    AgentThreadContext,
    "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
  > & {
    mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
    reasoning_effort?: "minimal" | "low" | "medium" | "high";
  };
  extraHeader?: React.ReactNode;
  isNewThread?: boolean;
  threadId: string;
  initialValue?: string;
  onContextChange?: (
    context: Omit<
      AgentThreadContext,
      "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
    > & {
      mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
      reasoning_effort?: "minimal" | "low" | "medium" | "high";
    },
  ) => void;
  onFollowupsVisibilityChange?: (visible: boolean) => void;
  onSubmit?: (message: PromptInputMessage) => void;
  onStop?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { models } = useModels();
  const { skills } = useSkills();
  const enabledSkills = useMemo(
    () => skills.filter((s) => s.enabled),
    [skills],
  );
  const { thread, isMock } = useThread();
  const { textInput } = usePromptInputController();
  const promptRootRef = useRef<HTMLDivElement | null>(null);

  const [followups, setFollowups] = useState<string[]>([]);
  const [followupsHidden, setFollowupsHidden] = useState(false);
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const lastGeneratedForAiIdRef = useRef<string | null>(null);
  const wasStreamingRef = useRef(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (models.length === 0) {
      return;
    }
    const currentModel = models.find((m) => m.name === context.model_name);
    const fallbackModel = currentModel ?? models[0]!;
    const supportsThinking = fallbackModel.supports_thinking ?? false;
    const nextModelName = fallbackModel.name;
    const nextMode = getResolvedMode(context.mode, supportsThinking);

    if (context.model_name === nextModelName && context.mode === nextMode) {
      return;
    }

    onContextChange?.({
      ...context,
      model_name: nextModelName,
      mode: nextMode,
    });
  }, [context, models, onContextChange]);

  const selectedModel = useMemo(() => {
    if (models.length === 0) {
      return undefined;
    }
    return models.find((m) => m.name === context.model_name) ?? models[0];
  }, [context.model_name, models]);

  const resolvedModelName = selectedModel?.name;

  const supportThinking = useMemo(
    () => selectedModel?.supports_thinking ?? false,
    [selectedModel],
  );

  const supportReasoningEffort = useMemo(
    () => selectedModel?.supports_reasoning_effort ?? false,
    [selectedModel],
  );

  const handleModelSelect = useCallback(
    (model_name: string) => {
      const model = models.find((m) => m.name === model_name);
      if (!model) {
        return;
      }
      onContextChange?.({
        ...context,
        model_name,
        mode: getResolvedMode(context.mode, model.supports_thinking ?? false),
        reasoning_effort: context.reasoning_effort,
      });
      setModelDialogOpen(false);
    },
    [onContextChange, context, models],
  );

  const handleModeSelect = useCallback(
    (mode: InputMode) => {
      onContextChange?.({
        ...context,
        mode: getResolvedMode(mode, supportThinking),
        reasoning_effort:
          mode === "ultra"
            ? "high"
            : mode === "pro"
              ? "medium"
              : mode === "thinking"
                ? "low"
                : "minimal",
      });
    },
    [onContextChange, context, supportThinking],
  );

  const handleReasoningEffortSelect = useCallback(
    (effort: "minimal" | "low" | "medium" | "high") => {
      onContextChange?.({
        ...context,
        reasoning_effort: effort,
      });
    },
    [onContextChange, context],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (status === "streaming") {
        onStop?.();
        return;
      }
      if (!message.text) {
        return;
      }
      setFollowups([]);
      setFollowupsHidden(false);
      setFollowupsLoading(false);

      // Guard against submitting before the initial model auto-selection
      // effect has flushed thread settings to storage/state.
      if (resolvedModelName && context.model_name !== resolvedModelName) {
        onContextChange?.({
          ...context,
          model_name: resolvedModelName,
          mode: getResolvedMode(
            context.mode,
            selectedModel?.supports_thinking ?? false,
          ),
        });
        setTimeout(() => onSubmit?.(message), 0);
        return;
      }

      onSubmit?.(message);
    },
    [
      context,
      onContextChange,
      onSubmit,
      onStop,
      resolvedModelName,
      selectedModel?.supports_thinking,
      status,
    ],
  );

  const requestFormSubmit = useCallback(() => {
    const form = promptRootRef.current?.querySelector("form");
    form?.requestSubmit();
  }, []);

  const handleFollowupClick = useCallback(
    (suggestion: string) => {
      if (status === "streaming") {
        return;
      }
      const current = (textInput.value ?? "").trim();
      if (current) {
        setPendingSuggestion(suggestion);
        setConfirmOpen(true);
        return;
      }
      textInput.setInput(suggestion);
      setFollowupsHidden(true);
      setTimeout(() => requestFormSubmit(), 0);
    },
    [requestFormSubmit, status, textInput],
  );

  const confirmReplaceAndSend = useCallback(() => {
    if (!pendingSuggestion) {
      setConfirmOpen(false);
      return;
    }
    textInput.setInput(pendingSuggestion);
    setFollowupsHidden(true);
    setConfirmOpen(false);
    setPendingSuggestion(null);
    setTimeout(() => requestFormSubmit(), 0);
  }, [pendingSuggestion, requestFormSubmit, textInput]);

  const confirmAppendAndSend = useCallback(() => {
    if (!pendingSuggestion) {
      setConfirmOpen(false);
      return;
    }
    const current = (textInput.value ?? "").trim();
    const next = current
      ? `${current}\n${pendingSuggestion}`
      : pendingSuggestion;
    textInput.setInput(next);
    setFollowupsHidden(true);
    setConfirmOpen(false);
    setPendingSuggestion(null);
    setTimeout(() => requestFormSubmit(), 0);
  }, [pendingSuggestion, requestFormSubmit, textInput]);

  const showFollowups =
    !disabled &&
    !isNewThread &&
    !followupsHidden &&
    (followupsLoading || followups.length > 0);

  const followupsVisibilityChangeRef = useRef(onFollowupsVisibilityChange);

  useEffect(() => {
    followupsVisibilityChangeRef.current = onFollowupsVisibilityChange;
  }, [onFollowupsVisibilityChange]);

  useEffect(() => {
    followupsVisibilityChangeRef.current?.(showFollowups);
  }, [showFollowups]);

  useEffect(() => {
    return () => followupsVisibilityChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    const streaming = status === "streaming";
    const wasStreaming = wasStreamingRef.current;
    wasStreamingRef.current = streaming;
    if (!wasStreaming || streaming) {
      return;
    }

    if (disabled || isMock) {
      return;
    }

    const lastAi = [...thread.messages].reverse().find((m) => m.type === "ai");
    const lastAiId = lastAi?.id ?? null;
    if (!lastAiId || lastAiId === lastGeneratedForAiIdRef.current) {
      return;
    }
    lastGeneratedForAiIdRef.current = lastAiId;

    const recent = thread.messages
      .filter((m) => m.type === "human" || m.type === "ai")
      .map((m) => {
        const role = m.type === "human" ? "user" : "assistant";
        const content = textOfMessage(m) ?? "";
        return { role, content };
      })
      .filter((m) => m.content.trim().length > 0)
      .slice(-6);

    if (recent.length === 0) {
      return;
    }

    const controller = new AbortController();
    setFollowupsHidden(false);
    setFollowupsLoading(true);
    setFollowups([]);

    fetch(`${getBackendBaseURL()}/api/threads/${threadId}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: recent,
        n: 3,
        model_name: context.model_name ?? undefined,
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          return { suggestions: [] as string[] };
        }
        return (await res.json()) as { suggestions?: string[] };
      })
      .then((data) => {
        const suggestions = (data.suggestions ?? [])
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter((s) => s.length > 0)
          .slice(0, 5);
        setFollowups(suggestions);
      })
      .catch(() => {
        setFollowups([]);
      })
      .finally(() => {
        setFollowupsLoading(false);
      });

    return () => controller.abort();
  }, [context.model_name, disabled, isMock, status, thread.messages, threadId]);

  return (
    <div ref={promptRootRef} className="relative flex flex-col gap-4">
      {showFollowups && (
        <div className="flex items-center justify-center pb-2">
          <div className="flex items-center gap-2">
            {followupsLoading ? (
              <div className="text-muted-foreground bg-background/80 rounded-full border px-4 py-2 text-xs backdrop-blur-sm">
                {t.inputBox.followupLoading}
              </div>
            ) : (
              <Suggestions className="min-h-16 w-fit items-start">
                {followups.map((s) => (
                  <Suggestion
                    key={s}
                    suggestion={s}
                    onClick={() => handleFollowupClick(s)}
                  />
                ))}
                <Button
                  aria-label={t.common.close}
                  className="text-muted-foreground cursor-pointer rounded-full px-3 text-xs font-normal"
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setFollowupsHidden(true)}
                >
                  <XIcon className="size-4" />
                </Button>
              </Suggestions>
            )}
          </div>
        </div>
      )}
      <PromptInput
        className={cn(
          "prompt-white-input rounded-2xl transition-all duration-300 ease-out *:data-[slot='input-group']:rounded-2xl",
          className,
        )}
        disabled={disabled}
        globalDrop
        multiple
        onSubmit={handleSubmit}
        {...props}
      >
        {extraHeader && (
          <div className="absolute top-0 right-0 left-0 z-10">
            <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center">
              {extraHeader}
            </div>
          </div>
        )}
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputBody className="absolute top-0 right-0 left-0 z-3">
          <PromptInputTextarea
            className={cn("size-full min-h-28")}
            disabled={disabled}
            placeholder={t.inputBox.placeholder}
            autoFocus={autoFocus}
            defaultValue={initialValue}
          />
        </PromptInputBody>
        <PromptInputFooter className="flex">
          <PromptInputTools className="flex-1 flex-wrap gap-1.5">
            {(
              [
                {
                  mode: "flash" as InputMode,
                  label: t.inputBox.flashMode,
                  icon: (
                    <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor" className="shrink-0">
                      <path d="M11.9085 4.64156L11.7516 5.00991C11.6368 5.27958 11.2723 5.27958 11.1574 5.00991L11.0006 4.64156C10.7209 3.98477 10.2171 3.46185 9.58854 3.17577L9.10509 2.95577C8.84374 2.83681 8.84374 2.4476 9.10509 2.32864L9.56149 2.12093C10.2063 1.8275 10.719 1.28522 10.9939 0.606122L11.155 0.208067C11.2673 -0.0693555 11.6418 -0.0693555 11.754 0.208067L11.9151 0.606122C12.1901 1.28522 12.7028 1.8275 13.3476 2.12093L13.8039 2.32864C14.0654 2.4476 14.0654 2.83681 13.8039 2.95577L13.3206 3.17577C12.692 3.46185 12.1882 3.98477 11.9085 4.64156ZM5.09091 1.30233L7.63636 1.30233L7.63636 2.60465L5.09091 2.60465C2.98218 2.60465 1.27273 4.35386 1.27273 6.51163C1.27273 8.86233 2.83951 10.3962 6.36364 12.0334L6.36364 10.4186L7.63636 10.4186C9.74508 10.4186 11.4545 8.66939 11.4545 6.51163L12.7273 6.51163C12.7273 9.38866 10.448 11.7209 7.63636 11.7209L7.63636 14C4.45455 12.6977 0 10.7442 0 6.51163C0 3.63461 2.27928 1.30233 5.09091 1.30233Z" />
                    </svg>
                  ),
                },
                {
                  mode: "thinking" as InputMode,
                  label: t.inputBox.reasoningMode,
                  icon: <LightbulbIcon className="size-3.5 shrink-0" />,
                },
                {
                  mode: "pro" as InputMode,
                  label: t.inputBox.proMode,
                  icon: (
                    <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor" className="shrink-0">
                      <path d="M1.1513 9.8487Q2.9526 11.65 5.5 11.65Q8.0474 11.65 9.8487 9.8487Q11.65 8.0474 11.65 5.5Q11.65 2.9526 9.8487 1.1513Q8.04741 -0.65 5.5 -0.65Q2.9526 -0.65 1.1513 1.1513Q-0.65 2.9526 -0.65 5.5Q-0.65 8.04741 1.1513 9.8487ZM8.92946 8.92946Q7.50893 10.35 5.5 10.35Q3.49107 10.35 2.07054 8.92946Q0.65 7.50893 0.65 5.5Q0.65 3.49107 2.07054 2.07054Q3.49107 0.65 5.5 0.65Q7.50893 0.65 8.92946 2.07054Q10.35 3.49107 10.35 5.5Q10.35 7.50893 8.92946 8.92946Z" />
                    </svg>
                  ),
                },
                {
                  mode: "ultra" as InputMode,
                  label: t.inputBox.ultraMode,
                  icon: (
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" className="shrink-0">
                      <rect x="1" y="1" width="14" height="14" rx="2" fillOpacity="0" stroke="currentColor" strokeWidth="1.3" />
                      <rect x="4" y="5" width="3" height="1.3" rx="0.65" />
                      <rect x="9" y="5" width="3" height="1.3" rx="0.65" />
                      <rect x="4" y="7" width="8" height="1.3" rx="0.65" />
                      <rect x="4" y="9" width="5" height="1.3" rx="0.65" />
                    </svg>
                  ),
                },
              ] as const
            ).map(({ mode, label, icon }) => (
              <ModeHoverGuide key={mode} mode={mode} showTitle={false}>
                <button
                  type="button"
                  onClick={() => handleModeSelect(mode)}
                  className={cn(
                    "flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] border px-2.5 text-sm font-normal transition-all duration-200 whitespace-nowrap",
                    context.mode === mode && mode === "ultra"
                      ? "border-[#BAD5FE] bg-[#EDF2FF] text-[#3284FF] dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                      : context.mode === mode
                        ? "border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                        : "border-[#E8ECF2] bg-white text-[#161C23] hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
                  )}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              </ModeHoverGuide>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#E8ECF2] bg-white px-2.5 text-sm font-normal text-[#161C23] transition-all duration-200 whitespace-nowrap hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <svg viewBox="0 0 14 14" width="14" height="14" fill="currentColor" className="shrink-0">
                    <path d="M7.65767 0.65272C7.65767 0.301255 7.35605 0 7.00417 0C6.64391 0 6.35067 0.301255 6.35067 0.65272L6.35067 2.66945C6.35067 3.02929 6.64391 3.32218 7.00417 3.32218C7.35605 3.32218 7.65767 3.02929 7.65767 2.66945L7.65767 0.65272ZM9.58467 3.49791C9.3333 3.74896 9.3333 4.16737 9.58467 4.41841C9.83596 4.66946 10.2633 4.66946 10.5063 4.41841L11.9389 2.99582C12.1819 2.74477 12.1819 2.318 11.9389 2.06695C11.6875 1.8159 11.2687 1.8159 11.0173 2.06695L9.58467 3.49791ZM3.49371 4.41841C3.74505 4.66946 4.16397 4.66946 4.4153 4.41841C4.65828 4.16737 4.65828 3.74896 4.4153 3.49791L2.99102 2.07532C2.74804 1.82427 2.32913 1.8159 2.0778 2.06695C1.82645 2.318 1.82645 2.7364 2.0778 2.98745L3.49371 4.41841ZM13.2878 12.2092C13.5811 12.5189 13.5894 13.0125 13.2878 13.3305C13.0029 13.6318 12.4751 13.6402 12.1736 13.3305L5.96527 7.10461C5.67204 6.80335 5.66366 6.30963 5.96527 5.99164C6.25014 5.68201 6.77796 5.68201 7.07957 5.99164L13.2878 12.2092ZM0.653499 6.3431C0.301615 6.3431 0 6.64436 0 6.99582C0 7.34729 0.301615 7.64854 0.653499 7.64854L2.68102 7.64854C3.03291 7.64854 3.33452 7.34729 3.33452 6.99582C3.33452 6.64436 3.03291 6.3431 2.68102 6.3431L0.653499 6.3431ZM14 6.99582C14 7.34729 13.7068 7.64854 13.3464 7.64854L11.3273 7.64854C10.9755 7.64854 10.6738 7.34729 10.6738 6.99582C10.6738 6.64436 10.9755 6.3431 11.3273 6.3431L13.3464 6.3431C13.7068 6.3431 14 6.64436 14 6.99582ZM2.06941 10.9958C1.81807 11.2469 1.81807 11.6653 2.06103 11.9163C2.31238 12.1674 2.73967 12.1758 2.98263 11.9247L4.4153 10.5021C4.65828 10.2511 4.65828 9.83264 4.4153 9.58156C4.17234 9.33058 3.74505 9.33058 3.49371 9.58156L2.06941 10.9958ZM7.65767 11.3306C7.65767 10.9707 7.35605 10.6778 7.00417 10.6778C6.64391 10.6778 6.35067 10.9707 6.35067 11.3306L6.35067 13.3473C6.35067 13.6987 6.64391 14 7.00417 14C7.35605 14 7.65767 13.6987 7.65767 13.3473L7.65767 11.3306Z" />
                  </svg>
                  <span>{t.inputBox.useSkillBtn}</span>
                  <svg viewBox="0 0 6 6" width="6" height="6" fill="currentColor" className="shrink-0 text-[#636F81]">
                    <path d="M0.353553 0.353553L3.35355 3.35355L0.353553 6.35355L-0.353553 5.64645L1.64645 3.64645L-0.353553 1.64645L0.353553 0.353553Z" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {enabledSkills.length === 0 ? (
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">
                    暂无可用技能
                  </div>
                ) : (
                  <DropdownMenuGroup>
                    {enabledSkills.map((skill) => (
                      <DropdownMenuItem
                        key={skill.name}
                        onClick={() =>
                          router.push(
                            `/workspace/chats/new?mode=skill&skill=${encodeURIComponent(skill.name)}`,
                          )
                        }
                      >
                        {skill.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </PromptInputTools>
          <PromptInputTools>
            <AddAttachmentsButton className="px-2!" />
            <ModelSelector
              open={modelDialogOpen}
              onOpenChange={setModelDialogOpen}
            >
              <ModelSelectorTrigger asChild>
                <PromptInputButton>
                  <div className="flex min-w-0 flex-col items-start text-left">
                    <ModelSelectorName className="text-xs font-normal">
                      {selectedModel?.display_name}
                    </ModelSelectorName>
                  </div>
                </PromptInputButton>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorInput placeholder={t.inputBox.searchModels} />
                <ModelSelectorList>
                  {models.map((m) => (
                    <ModelSelectorItem
                      key={m.name}
                      value={m.name}
                      onSelect={() => handleModelSelect(m.name)}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <ModelSelectorName>{m.display_name}</ModelSelectorName>
                        <span className="text-muted-foreground truncate text-[10px]">
                          {m.model}
                        </span>
                      </div>
                      {m.name === context.model_name ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
            <PromptInputSubmit
              className="rounded-full"
              disabled={disabled}
              variant="outline"
              status={status}
            />
          </PromptInputTools>
        </PromptInputFooter>
        {!isNewThread && (
          <div className="bg-background absolute right-0 -bottom-[17px] left-0 z-0 h-4"></div>
        )}
      </PromptInput>


      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.inputBox.followupConfirmTitle}</DialogTitle>
            <DialogDescription>
              {t.inputBox.followupConfirmDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="secondary" onClick={confirmAppendAndSend}>
              {t.inputBox.followupConfirmAppend}
            </Button>
            <Button onClick={confirmReplaceAndSend}>
              {t.inputBox.followupConfirmReplace}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SuggestionList() {
  const { t } = useI18n();
  const { textInput } = usePromptInputController();
  const handleSuggestionClick = useCallback(
    (prompt: string | undefined) => {
      if (!prompt) return;
      textInput.setInput(prompt);
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          "textarea[name='message']",
        );
        if (textarea) {
          const selStart = prompt.indexOf("[");
          const selEnd = prompt.indexOf("]");
          if (selStart !== -1 && selEnd !== -1) {
            textarea.setSelectionRange(selStart, selEnd + 1);
            textarea.focus();
          }
        }
      }, 500);
    },
    [textInput],
  );
  return (
    <Suggestions className="min-h-16 w-fit items-start">
      <ConfettiButton
        className="text-muted-foreground cursor-pointer rounded-full px-4 text-xs font-normal"
        variant="outline"
        size="sm"
        onClick={() => handleSuggestionClick(t.inputBox.surpriseMePrompt)}
      >
        <SparklesIcon className="size-4" /> {t.inputBox.surpriseMe}
      </ConfettiButton>
      {t.inputBox.suggestions.map((suggestion) => (
        <Suggestion
          key={suggestion.suggestion}
          icon={suggestion.icon}
          suggestion={suggestion.suggestion}
          onClick={() => handleSuggestionClick(suggestion.prompt)}
        />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Suggestion icon={PlusIcon} suggestion={t.common.create} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            {t.inputBox.suggestionsCreate.map((suggestion, index) =>
              "type" in suggestion && suggestion.type === "separator" ? (
                <DropdownMenuSeparator key={index} />
              ) : (
                !("type" in suggestion) && (
                  <DropdownMenuItem
                    key={suggestion.suggestion}
                    onClick={() => handleSuggestionClick(suggestion.prompt)}
                  >
                    {suggestion.icon && <suggestion.icon className="size-4" />}
                    {suggestion.suggestion}
                  </DropdownMenuItem>
                )
              ),
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Suggestions>
  );
}

function AddAttachmentsButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const attachments = usePromptInputAttachments();
  return (
    <Tooltip content={t.inputBox.addAttachments}>
      <PromptInputButton
        className={cn("px-2!", className)}
        onClick={() => attachments.openFileDialog()}
      >
        <PaperclipIcon className="size-3" />
      </PromptInputButton>
    </Tooltip>
  );
}
