"use client";

export interface DappKitExecutionInput {
  method: "signAndExecuteSponsoredTransaction";
  moveCall: {
    target: string;
    arguments: Record<string, string | number | boolean>;
  };
  routePassId: string;
  sourceSnapshotId: string;
}

export interface DappKitExecutionResult {
  digest: string;
}

type DappKitLike = {
  signAndExecuteSponsoredTransaction: (payload: {
    transaction: unknown;
  }) => Promise<{ digest: string }>;
};

export async function executeSponsoredWithDappKit(
  input: DappKitExecutionInput,
): Promise<DappKitExecutionResult> {
  const dynamicImport = Function("m", "return import(m)") as (moduleName: string) => Promise<unknown>;
  const dappKit = (await dynamicImport("@evefrontier/dapp-kit").catch(() => null)) as DappKitLike | null;
  if (!dappKit) {
    throw new Error("DAPP_KIT_UNAVAILABLE");
  }

  // Keep transaction payload portable for integration environments where
  // the exact TransactionBuilder lives in wallet context.
  const receipt = await dappKit.signAndExecuteSponsoredTransaction({
    transaction: {
      kind: "MoveCall",
      target: input.moveCall.target,
      arguments: input.moveCall.arguments,
      routePassId: input.routePassId,
      sourceSnapshotId: input.sourceSnapshotId,
    },
  });

  if (!receipt?.digest) {
    throw new Error("DAPP_KIT_NO_DIGEST");
  }

  return {
    digest: receipt.digest,
  };
}
