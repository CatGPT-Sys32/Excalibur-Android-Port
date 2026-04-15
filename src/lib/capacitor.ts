import { Capacitor } from "@capacitor/core";

export const isNativePlatform = Capacitor.isNativePlatform();
export const isAndroid = Capacitor.getPlatform() === "android";
