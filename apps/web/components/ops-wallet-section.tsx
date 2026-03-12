"use client";

import dynamic from "next/dynamic";

const WalletConnectionCard = dynamic(
  () => import("./wallet-connection-card").then((mod) => mod.WalletConnectionCard),
  { ssr: false },
);

export function OpsWalletSection() {
  return (
    <section className="grid two mt-18">
      <WalletConnectionCard />
      <div className="panel panel-tight">
        <strong>Official Wallet Path</strong>
        <p className="muted">
          Ops and Overlay now share the same official EVE Frontier wallet session. Use this panel to verify EVE Vault
          connectivity before collecting Stillness evidence.
        </p>
        <p className="muted code">
          dapp-kit provider active / route pass confirmation via indexer transaction checks
        </p>
      </div>
    </section>
  );
}
