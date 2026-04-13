"use client";

import { MessageSquarePlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";
import { env } from "@/env";
import { cn } from "@/lib/utils";

export function WorkspaceHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state } = useSidebar();
  const pathname = usePathname();
  return (
    <>
      <div
        className={cn(
          "group/workspace-header flex h-12 flex-col justify-center",
          className,
        )}
      >
        {state === "collapsed" ? (
          <div className="group-has-data-[collapsible=icon]/sidebar-wrapper:-translate-y flex w-full cursor-pointer items-center justify-center">
            <Image
              src="https://flames.iflytek.com:1443/intel/logo.png"
              alt="Logo"
              width={28}
              height={28}
              className="block group-hover/workspace-header:hidden"
              unoptimized
            />
            <SidebarTrigger className="hidden pl-2 group-hover/workspace-header:block" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="ml-2 flex items-center gap-2">
              <Image
                src="https://flames.iflytek.com:1443/intel/logo.png"
                alt="Logo"
                width={24}
                height={24}
                className="h-6 w-6 shrink-0"
                unoptimized
              />
              <span className="text-sidebar-foreground font-semibold">Spark-Agent</span>
            </div>
            <SidebarTrigger />
          </div>
        )}
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname === "/workspace/chats/new"}
            asChild
          >
            <Link className="text-sidebar-foreground/70" href="/workspace/chats/new">
              <MessageSquarePlus size={16} />
              <span>{t.sidebar.newChat}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
