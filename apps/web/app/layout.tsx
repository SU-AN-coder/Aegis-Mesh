import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis Mesh",
  description: "Alliance safety and logistics infrastructure for EVE Frontier.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">
              <strong>Aegis Mesh</strong>
              <span>Civilization Infrastructure for borders, convoys, and response.</span>
            </div>
            <nav>
              <Link href="/ops">Ops Console</Link>
              <Link href="/overlay">In-Game Overlay</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
