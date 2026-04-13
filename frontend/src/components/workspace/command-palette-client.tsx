"use client";

import dynamic from "next/dynamic";

// Client-only wrapper for CommandPalette.
//
// CommandPalette renders Radix Dialog primitives whose `useId`-generated
// `aria-controls` / `id` attributes were producing hydration mismatches
// (server-rendered IDs differ from the client-rendered ones once any
// upstream tree shape changes).  Disabling SSR for this component is
// safe — it has no SEO value and only appears after the user opens it
// with a keyboard shortcut.
export const CommandPaletteClient = dynamic(
  () =>
    import("./command-palette").then((m) => ({ default: m.CommandPalette })),
  { ssr: false },
);
