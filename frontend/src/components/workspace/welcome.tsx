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
        "mx-auto flex w-full flex-col items-center justify-center gap-0 px-2 py-6",
        className,
      )}
    >
      <div
        className="mb-[26px] h-[56px] w-[384px] bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/images/title-bg.svg')" }}
        role="heading"
        aria-level={1}
        aria-label={t.welcome.title}
      />
      <div
        className="mb-[40px] h-[30px] w-[448px] bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/images/desc-bg.svg')" }}
        aria-label={t.welcome.subtitlePrefix}
      />
    </div>
  );
}
