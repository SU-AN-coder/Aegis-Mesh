"use client";

import { useEffect, useState } from "react";

export interface GameBridgeEvent<T extends string, P> {
  source: "eve-frontier" | "aegis-mesh";
  type: T;
  payload: P;
  timestamp: number;
  correlationId?: string;
}

export interface PlayerEnteredRangePayload {
  characterId: string;
  gateId: string;
  solarSystemId: string;
  distance: number;
}

export interface PlayerLeftRangePayload {
  characterId: string;
  gateId: string;
  reason: "moved_away" | "jumped" | "docked" | "disconnected";
}

export interface DistressShortcutPayload {
  characterId: string;
  solarSystemId: string;
  threatType?: "COMBAT" | "BLOCKADE" | "UNKNOWN";
}

export interface SystemChangedPayload {
  characterId: string;
  fromSystemId: string;
  toSystemId: string;
  viaGateId?: string;
}

export interface OverlayOpenedPayload {
  mode: "live" | "sim";
  panelType: "route" | "distress" | "intel";
}

export interface RoutePassSuccessPayload {
  passId: string;
  txDigest: string;
  sourceGateId: string;
  destGateId: string;
  quotedCost: number;
}

export interface DistressSubmittedPayload {
  beaconId: string;
  characterId: string;
  systemId: string;
  txDigest?: string;
}

export interface IncidentReadyPayload {
  incidentId: string;
  beaconId: string;
  status: "OPEN" | "EVIDENCE_ATTACHED" | "AUDITOR_APPROVED";
}

export type OverlayInputEvent =
  | GameBridgeEvent<"PLAYER_ENTERED_RANGE", PlayerEnteredRangePayload>
  | GameBridgeEvent<"PLAYER_LEFT_RANGE", PlayerLeftRangePayload>
  | GameBridgeEvent<"DISTRESS_SHORTCUT", DistressShortcutPayload>
  | GameBridgeEvent<"SYSTEM_CHANGED", SystemChangedPayload>;

export type OverlayOutputEvent =
  | GameBridgeEvent<"OVERLAY_OPENED", OverlayOpenedPayload>
  | GameBridgeEvent<"ROUTE_PASS_SUCCESS", RoutePassSuccessPayload>
  | GameBridgeEvent<"DISTRESS_SUBMITTED", DistressSubmittedPayload>
  | GameBridgeEvent<"INCIDENT_READY", IncidentReadyPayload>;

const validInputTypes = new Set([
  "PLAYER_ENTERED_RANGE",
  "PLAYER_LEFT_RANGE",
  "DISTRESS_SHORTCUT",
  "SYSTEM_CHANGED",
]);

function bridgeTargetOrigin(): string {
  return process.env.NEXT_PUBLIC_GAME_BRIDGE_ORIGIN ?? "*";
}

function isValidGameOrigin(origin: string): boolean {
  const configured = process.env.NEXT_PUBLIC_GAME_BRIDGE_ORIGIN;
  if (!configured) {
    return true;
  }
  return origin === configured;
}

function extractCharacterId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const maybeCharacterId = (payload as { characterId?: unknown }).characterId;
  return typeof maybeCharacterId === "string" ? maybeCharacterId : null;
}

function isOverlayInputEvent(value: unknown, expectedCharacterId?: string): value is OverlayInputEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as {
    source?: unknown;
    type?: unknown;
    timestamp?: unknown;
  };

  if (event.source !== "eve-frontier") {
    return false;
  }

  if (typeof event.type !== "string" || !validInputTypes.has(event.type)) {
    return false;
  }

  if (typeof event.timestamp !== "number") {
    return false;
  }

  const characterId = extractCharacterId((value as { payload?: unknown }).payload);
  if (expectedCharacterId && characterId !== null && characterId !== expectedCharacterId) {
    return false;
  }

  const ageMs = Math.abs(Date.now() - event.timestamp);
  return ageMs <= 30_000;
}

function hasGameParentWindow(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.parent !== window;
}

export function useGameBridge() {
  const [events, setEvents] = useState<OverlayInputEvent[]>([]);
  const [hasBridge, setHasBridge] = useState(false);

  useEffect(() => {
    const inBridge = hasGameParentWindow();
    setHasBridge(inBridge);
    const expectedCharacterId = process.env.NEXT_PUBLIC_OVERLAY_CHARACTER_ID;

    const listener = (event: MessageEvent) => {
      if (!isValidGameOrigin(event.origin)) {
        return;
      }
      if (!isOverlayInputEvent(event.data, expectedCharacterId)) {
        return;
      }
      setEvents((current) => [event.data, ...current].slice(0, 20));
    };

    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  function emitToGame(event: OverlayOutputEvent) {
    if (hasGameParentWindow()) {
      window.parent.postMessage(event, bridgeTargetOrigin());
    }
    window.dispatchEvent(new CustomEvent(event.type, { detail: event.payload }));
  }

  function simulateEnterRange() {
    const simulated: OverlayInputEvent = {
      source: "eve-frontier",
      type: "PLAYER_ENTERED_RANGE",
      payload: {
        characterId: "pilot-blue-01",
        gateId: "gate-alpha-7",
        solarSystemId: "stillness-alpha-7",
        distance: 84,
      },
      timestamp: Date.now(),
    };
    window.postMessage(simulated, "*");
  }

  function simulateDistress() {
    const simulated: OverlayInputEvent = {
      source: "eve-frontier",
      type: "DISTRESS_SHORTCUT",
      payload: {
        characterId: "pilot-blue-01",
        solarSystemId: "stillness-beta-3",
        threatType: "COMBAT",
      },
      timestamp: Date.now(),
    };
    window.postMessage(simulated, "*");
  }

  return {
    events,
    hasBridge,
    emitToGame,
    simulateEnterRange,
    simulateDistress,
  };
}
