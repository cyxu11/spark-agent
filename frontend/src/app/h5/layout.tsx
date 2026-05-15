import type { Viewport } from "next";
import { Toaster } from "sonner";

import { QueryClientProvider } from "@/components/query-client-provider";
import { SidebarProvider } from "@/components/ui/sidebar";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function H5Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // SidebarProvider is mounted only to satisfy ArtifactsProvider's useSidebar()
  // dependency — no actual <Sidebar> / <WorkspaceSidebar> is rendered. The
  // className overrides its default `flex min-h-svh` so the H5 layout stays
  // a vertical 100dvh container.
  return (
    <QueryClientProvider>
      <SidebarProvider className="bg-background flex h-[100dvh] w-full flex-col overflow-hidden">
        {children}
      </SidebarProvider>
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
