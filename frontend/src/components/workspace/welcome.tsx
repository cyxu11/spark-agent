"use client";

import { useSearchParams } from "next/navigation";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function Welcome({
  className,
}: {
  className?: string;
  mode?: "ultra" | "pro" | "thinking" | "flash";
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();

  if (searchParams.get("mode") === "skill") {
    return (
      <div
        className={cn(
          "mx-auto flex w-full flex-col items-center justify-center gap-2 px-8 py-4 text-center",
          className,
        )}
      >
        <div className="text-2xl font-bold">
          {`✨ ${t.welcome.createYourOwnSkill} ✨`}
        </div>
        <div className="text-muted-foreground text-sm">
          <p>{t.welcome.createYourOwnSkillDescription}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col items-start justify-center gap-1 px-2 py-6",
        className,
      )}
    >
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
        星火行业大师
      </h1>
      <p className="text-lg text-gray-600 dark:text-gray-400">
        行业信息，一问即答，
        <span className="font-medium text-blue-500">深度研究</span>
      </p>
    </div>
  );
}
