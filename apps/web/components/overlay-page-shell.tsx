"use client";

import dynamic from "next/dynamic";

const OverlayConsole = dynamic(
  () => import("./overlay-console").then((mod) => mod.OverlayConsole),
  { ssr: false },
);

export function OverlayPageShell() {
  return <OverlayConsole />;
}
