"use client";

import { EveFrontierProvider } from "@evefrontier/dapp-kit";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

export function AegisEveFrontierProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <EveFrontierProvider queryClient={queryClient}>
      {children}
    </EveFrontierProvider>
  );
}
