"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

// DSL icon — 资讯中心 / chat history (16×16)
function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} fill="currentColor" aria-hidden="true">
      <path d="M5.6 9.6L5.6 12L10.4 12L10.4 9.6L16 9.6L16 15.2C16 15.6418 15.6418 16 15.2 16L0.8 16C0.358176 16 0 15.6418 0 15.2L0 9.6L5.6 9.6ZM7.2 8L8.8 8L8.8 10.4L7.2 10.4L7.2 8ZM16 0L16 8.8L10.4 8.8L10.4 8L8.8 8L8.8 8.8L7.2 8.8L7.2 8L5.6 8L5.6 8.8L0 8.8L0 0L16 0Z" />
    </svg>
  );
}

// DSL icon — 成员管理 / agents (16×16)
function AgentsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} fill="currentColor" aria-hidden="true">
      <path d="M8 6.4C9.76728 6.4 11.2 4.96731 11.2 3.2C11.2 1.43269 9.76728 0 8 0C6.23269 0 4.8 1.43269 4.8 3.2C4.8 4.96731 6.23269 6.4 8 6.4ZM2.8 8.8C3.90457 8.8 4.8 7.90457 4.8 6.8C4.8 5.69543 3.90457 4.8 2.8 4.8C1.69543 4.8 0.8 5.69543 0.8 6.8C0.8 7.90457 1.69543 8.8 2.8 8.8ZM13.2 8.8C14.3046 8.8 15.2 7.90457 15.2 6.8C15.2 5.69543 14.3046 4.8 13.2 4.8C12.0954 4.8 11.2 5.69543 11.2 6.8C11.2 7.90457 12.0954 8.8 13.2 8.8ZM8 7.2C5.34903 7.2 3.2 9.34903 3.2 12L3.2 16L12.8 16L12.8 12C12.8 9.34903 10.651 7.2 8 7.2ZM2.4 16L0 16L0 12.8C0 11.0326 1.03261 9.50667 2.53071 8.82095C2.66667 9.07048 2.83333 9.30476 3.02857 9.51429C1.70476 10.1562 0.8 11.3867 0.8 12.8L0.8 15.2L2.4 15.2L2.4 16ZM13.6 16L13.6 15.2L15.2 15.2L15.2 12.8C15.2 11.3867 14.2952 10.1562 12.9714 9.51429C13.1667 9.30476 13.3333 9.07048 13.4693 8.82095C14.9674 9.50667 16 11.0326 16 12.8L16 16L13.6 16Z" />
    </svg>
  );
}

// DSL icon — 审计日志 / scheduled tasks (16×16)
function ScheduledIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0", className)} fill="currentColor" aria-hidden="true">
      <path d="M12 1.6L15.2 1.6C15.6418 1.6 16 1.95818 16 2.4L16 15.2C16 15.6418 15.6418 16 15.2 16L0.8 16C0.358176 16 0 15.6418 0 15.2L0 2.4C0 1.95818 0.358176 1.6 0.8 1.6L4 1.6L4 0L5.6 0L5.6 1.6L10.4 1.6L10.4 0L12 0L12 1.6ZM1.6 6.4L1.6 14.4L14.4 14.4L14.4 6.4L1.6 6.4ZM1.6 3.2L1.6 4.8L14.4 4.8L14.4 3.2L1.6 3.2ZM3.2 8L7.2 8L7.2 12L3.2 12L3.2 8Z" />
    </svg>
  );
}

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <SidebarGroup className="pt-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton isActive={pathname === "/workspace/chats"} asChild>
            <Link href="/workspace/chats">
              <HistoryIcon />
              <span>{t.sidebar.chats}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/agents")}
            asChild
          >
            <Link href="/workspace/agents">
              <AgentsIcon />
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/scheduled-tasks")}
            asChild
          >
            <Link href="/workspace/scheduled-tasks">
              <ScheduledIcon />
              <span>{t.sidebar.scheduledTasks}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
