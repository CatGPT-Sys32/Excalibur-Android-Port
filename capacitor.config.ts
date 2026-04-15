import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.badeparday.excalidrawpersonal",
  appName: "Escalidraw",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      backgroundColor: "#f7f5f2",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#f7f5f2",
      overlaysWebView: false,
    },
  },
};

export default config;
