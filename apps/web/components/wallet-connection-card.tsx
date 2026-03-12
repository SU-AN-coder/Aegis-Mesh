"use client";

import { AegisEveFrontierProvider } from "./eve-frontier-provider";
import { useDappKitBridge } from "./dapp-kit-adapter";

function WalletConnectionCardInner() {
  const {
    currentAccount,
    walletAddress,
    isConnected,
    hasEveVault,
    hasSponsoredWallet,
    handleConnect,
    handleDisconnect,
  } = useDappKitBridge();

  return (
    <div className="panel panel-tight">
      <div className="split">
        <strong>Wallet Session</strong>
        <span className="badge" data-tone={isConnected ? "good" : "danger"}>
          {isConnected ? "connected" : "disconnected"}
        </span>
      </div>
      <p className="muted code">
        {walletAddress ?? "No wallet connected"}
      </p>
      <p className="muted">
        Eve Vault detected: {String(hasEveVault)}. Sponsored wallet feature: {String(hasSponsoredWallet)}.
      </p>
      {currentAccount ? (
        <p className="muted code">account {currentAccount.address}</p>
      ) : null}
      <div className="overlay-actions mt-14">
        {isConnected ? (
          <button className="button secondary" onClick={handleDisconnect}>
            Disconnect wallet
          </button>
        ) : (
          <button className="button" onClick={handleConnect}>
            Connect EVE Vault
          </button>
        )}
      </div>
    </div>
  );
}

export function WalletConnectionCard() {
  return (
    <AegisEveFrontierProvider>
      <WalletConnectionCardInner />
    </AegisEveFrontierProvider>
  );
}
