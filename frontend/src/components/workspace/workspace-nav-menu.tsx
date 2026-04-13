"use client";

import { SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

import { SettingsDialog } from "./settings";

export function WorkspaceNavMenu() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { open: isSidebarOpen } = useSidebar();
  const { t } = useI18n();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        defaultSection="appearance"
      />
      <SidebarMenu className="w-full">
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            onClick={mounted ? () => setSettingsOpen(true) : undefined}
            disabled={!mounted}
          >
            {isSidebarOpen ? (
              <div className="text-sidebar-foreground/70 flex w-full items-center gap-2 text-left text-sm">
                <SettingsIcon className="size-4" />
                <span>{t.common.settings}</span>
              </div>
            ) : (
              <div className="flex size-full items-center justify-center">
                <SettingsIcon className="text-sidebar-foreground/70 size-4" />
              </div>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
