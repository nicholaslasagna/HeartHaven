"use client";

export const MULTIPLAYER_DIAGNOSTIC_EVENT = "hearthaven:multiplayer-diagnostic";

export type MultiplayerRpcDiagnostic = {
  error?: string;
  name: string;
  ok: boolean;
  timestamp: string;
};

export function isMultiplayerDiagnosticsEnabled() {
  return process.env.NEXT_PUBLIC_DEBUG_MULTIPLAYER === "true" || process.env.NODE_ENV !== "production";
}

export function recordMultiplayerRpc(name: string, error?: unknown) {
  if (!isMultiplayerDiagnosticsEnabled() || typeof window === "undefined") return;

  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "unknown error")
        : undefined;

  const detail: MultiplayerRpcDiagnostic = {
    error: message,
    name,
    ok: !message,
    timestamp: new Date().toISOString(),
  };

  window.dispatchEvent(new CustomEvent(MULTIPLAYER_DIAGNOSTIC_EVENT, { detail }));

  if (message) {
    console.error("[HeartHaven multiplayer RPC]", detail);
  } else {
    console.debug("[HeartHaven multiplayer RPC]", detail);
  }
}
