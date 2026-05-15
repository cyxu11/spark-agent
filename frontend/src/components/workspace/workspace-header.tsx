"use client";

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
import { cn } from "@/lib/utils";

// DSL layer 7561:28138 — portal/home icon (15.78×15.9)
function PortalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0", className)}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M0.631237 6.89658C0.0420177 6.89658 -0.224718 6.15985 0.227933 5.78264L6.61083 0.463557C7.35252 -0.154519 8.42988 -0.154519 9.17157 0.463557L15.5545 5.78264C16.0071 6.15985 15.7404 6.89658 15.1512 6.89658C14.4553 6.89658 13.8912 7.46069 13.8912 8.15655L13.8912 13.8966C13.8912 15.0012 12.9958 15.8966 11.8912 15.8966L3.8912 15.8966C2.78663 15.8966 1.8912 15.0012 1.8912 13.8966L1.8912 8.15655C1.8912 7.46069 1.32709 6.89658 0.631237 6.89658ZM9.8912 14.8966L5.8912 14.8966L5.8912 12.8966C5.8912 12.3443 6.33891 11.8966 6.8912 11.8966L8.8912 11.8966C9.44348 11.8966 9.8912 12.3443 9.8912 12.8966L9.8912 14.8966Z" />
    </svg>
  );
}

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
              <span className="text-sidebar-foreground font-semibold">数链智研平台</span>
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
            <Link href="/workspace/chats/new">
              <PortalIcon />
              <span>{t.sidebar.newChat}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
