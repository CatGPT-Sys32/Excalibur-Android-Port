import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type PendingOpenPayload = {
  name: string;
  mimeType: string;
  data: string;
  encoding: "utf8" | "base64";
  action: "view" | "send" | "unknown";
};

export type NativeStylusSnapshot = {
  toolType: "finger" | "stylus" | "mouse" | "eraser" | "unknown";
  pointerType: "touch" | "pen" | "mouse" | "unknown";
  hovering: boolean;
  pressure: number;
  tiltX: number;
  tiltY: number;
  buttonState: number;
  timestamp: number;
};

type IntentOpenEvent = {
  pendingOpen: PendingOpenPayload;
};

type StylusChangeEvent = {
  stylus: NativeStylusSnapshot;
};

interface DrawBridgePlugin {
  getPendingOpen(): Promise<{ pendingOpen: PendingOpenPayload | null }>;
  clearPendingOpen(): Promise<void>;
  getStylusSnapshot(): Promise<{ stylus: NativeStylusSnapshot | null }>;
  addListener(
    eventName: "intentOpen",
    listenerFunc: (event: IntentOpenEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "stylusChange",
    listenerFunc: (event: StylusChangeEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const DrawBridge = registerPlugin<DrawBridgePlugin>("DrawBridge");

const NOOP_LISTENER: PluginListenerHandle = {
  remove: async () => undefined,
};

export const getPendingOpenSafe = async () => {
  try {
    return (await DrawBridge.getPendingOpen()).pendingOpen;
  } catch {
    return null;
  }
};

export const clearPendingOpenSafe = async () => {
  try {
    await DrawBridge.clearPendingOpen();
  } catch {
    // ignored on web and before native plugin registration
  }
};

export const getStylusSnapshotSafe = async () => {
  try {
    return (await DrawBridge.getStylusSnapshot()).stylus;
  } catch {
    return null;
  }
};

export const addIntentOpenListener = async (
  listener: (payload: PendingOpenPayload) => void,
) => {
  try {
    return await DrawBridge.addListener("intentOpen", (event) =>
      listener(event.pendingOpen),
    );
  } catch {
    return NOOP_LISTENER;
  }
};

export const addStylusChangeListener = async (
  listener: (stylus: NativeStylusSnapshot) => void,
) => {
  try {
    return await DrawBridge.addListener("stylusChange", (event) =>
      listener(event.stylus),
    );
  } catch {
    return NOOP_LISTENER;
  }
};
