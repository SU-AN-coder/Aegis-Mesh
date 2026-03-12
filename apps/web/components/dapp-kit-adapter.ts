"use client";

import { useConnection, walletSupportsSponsoredTransaction } from "@evefrontier/dapp-kit";
import { useWallets } from "@mysten/dapp-kit-react";

export interface DappKitExecutionInput {
  method: "signAndExecuteBridgeTransaction";
  configured: boolean;
  target: string | null;
  packageId: string | null;
  serverRegistryId: string | null;
  clockObjectId: string;
  sourceGateId: string;
  destinationGateId: string;
  characterObjectId: string;
  locationProof: string | null;
  expiresAtMs: number;
  routePassId: string;
  sourceSnapshotId: string;
}

export function useDappKitBridge() {
  const connection = useConnection();
  const wallets = useWallets();
  const hasSponsoredWallet = wallets.some((wallet) =>
    walletSupportsSponsoredTransaction(
      wallet as unknown as Parameters<typeof walletSupportsSponsoredTransaction>[0],
    ),
  );

  return {
    ...connection,
    hasSponsoredWallet,
  };
}

export async function executeSponsoredWithDappKit(
  _input: DappKitExecutionInput,
): Promise<never> {
  throw new Error("DAPP_KIT_BRIDGE_MOVE_CALL_NOT_AVAILABLE");
}
