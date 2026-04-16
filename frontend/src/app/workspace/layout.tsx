import { Toaster } from "sonner";

import { QueryClientProvider } from "@/components/query-client-provider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ChatHistoryButton } from "@/components/workspace/chat-history-button";
import { CommandPaletteClient } from "@/components/workspace/command-palette-client";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <QueryClientProvider>
      <SidebarProvider className="h-screen" defaultOpen={false}>
        <main className="min-w-0 flex-1">{children}</main>
      </SidebarProvider>
      <ChatHistoryButton />
      <CommandPaletteClient />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
