# Excalidraw Personal for Android

Android-packaged personal-use Excalidraw built around the official `@excalidraw/excalidraw` editor, with a thin Capacitor shell and an Android bridge for file intents and stylus metadata.

## What This Project Does

- Preserves the official Excalidraw editor as the core canvas, toolbar, library, dialogs, export flow, and scene format.
- Packages the editor as a real Android app with a Capacitor Android project under [`android/`](./android).
- Adds Android-aware recovery, export/share helpers, file-open intents, and stylus signal bridging without rewriting the drawing engine.

## Architecture Decisions

- Editor core: official `@excalidraw/excalidraw@0.18.0`.
- App shell: React + TypeScript + Vite.
- Android packaging: Capacitor 5 with a generated Gradle project.
- Offline assets: Excalidraw runtime assets are copied into `public/excalidraw-assets/` by [`scripts/sync-excalidraw-assets.mjs`](./scripts/sync-excalidraw-assets.mjs), and the app points `window.EXCALIDRAW_ASSET_PATH` there.
- Persistence: local-first scene autosave plus recovery snapshots using Capacitor Filesystem + Preferences.
- Native bridge: [`android/app/src/main/java/com/badeparday/excalidrawpersonal/DrawBridgePlugin.java`](./android/app/src/main/java/com/badeparday/excalidrawpersonal/DrawBridgePlugin.java) exposes:
  - pending file-open/share intents
  - stylus tool type, hover, pressure, button state
- Android activity glue: [`MainActivity.java`](./android/app/src/main/java/com/badeparday/excalidrawpersonal/MainActivity.java) forwards intents and `MotionEvent` data into the bridge.
- Responsive shell: custom file/recovery/input panel uses Excalidraw `Sidebar`, so it docks on wide layouts and becomes an overlay on smaller ones.

## Implemented Features

- Infinite Excalidraw canvas with official toolbar, selection model, arrows, free draw, text, image tool, eraser, zoom, pan, undo/redo, dark mode, and library support through upstream UI.
- `.excalidraw` scene compatibility via upstream `loadFromBlob()` and `serializeAsJSON()`.
- `.excalidrawlib` import/export support.
- Local autosave of the active scene.
- Recovery snapshot archive for restoring recent local states.
- Device-side export helpers for:
  - `.excalidraw`
  - `.excalidrawlib`
  - PNG
  - SVG
- Share current scene through Android share sheet.
- Android `ACTION_VIEW` and `ACTION_SEND` handling for scene/library files.
- Stylus-aware bridge with:
  - finger vs stylus vs mouse detection
  - hover signal exposure
  - pressure and tilt metadata exposure
  - stylus eraser tool switching when Android reports eraser mode
- Excalidraw pen mode surfaced as a user toggle in the in-app device panel.
- Tablet-friendly dockable side panel plus a compact floating trigger on smaller layouts.
- Placeholder Android launcher and splash assets generated for this project under [`resources/android/`](./resources/android).

## Current Gaps vs Official Excalidraw Site

- Collaboration is not wired yet.
  - The code keeps this as a clean feature boundary and documents it as future work.
- Incoming Android file intents are optimized for `.excalidraw` and `.excalidrawlib`.
  - Direct image-file intents are not turned into inserted canvas image elements yet.
- Native save uses app-accessible Documents export plus Android sharing rather than a SAF “Save As” document picker.
- The published package does not expose the newer `useEditorInterface` helper, so the responsive shell uses the stable `useDevice()` hook instead.
- Exported JS bundles are still large because upstream Excalidraw and Mermaid chunks dominate the payload.

## Stylus Notes

- Web/editor side:
  - Excalidraw already supports `pointerType === "pen"` and its own `penMode` behavior.
  - When pen mode is enabled, finger input is reserved for navigation-heavy behavior while pen remains the primary editing tool.
- Android-native side:
  - `MotionEvent.getToolType()` is forwarded into JS as `finger`, `stylus`, `mouse`, or `eraser`.
  - Hover state comes from hover/generic motion events when the device reports it.
  - Pressure, tilt, and button state are exposed to the app shell.
  - If Android reports eraser tool type, the shell temporarily switches Excalidraw into eraser mode.
- User control:
  - The device panel has toggles for `Stylus mode` and `Native stylus bridge`.

## Local Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the web app:

   ```bash
   npm run dev
   ```

3. Build the web bundle:

   ```bash
   npm run build
   ```

## Android Run

1. Make sure Android SDK and Java are available.
   - Default script assumptions:
     - `ANDROID_HOME=$HOME/Android/Sdk`
     - `ANDROID_SDK_ROOT=$HOME/Android/Sdk`
     - `JAVA_HOME=/opt/android-studio/jbr`

2. Sync web assets into the Android project:

   ```bash
   npm run android:sync
   ```

3. Open in Android Studio if needed:

   ```bash
   npm run android:open
   ```

## Build APK

Debug APK:

```bash
npm run android:build:debug
```

Release APK:

```bash
npm run android:build:release
```

Latest verified debug APK output:

- [`android/app/build/outputs/apk/debug/app-debug.apk`](./android/app/build/outputs/apk/debug/app-debug.apk)

## Important Files

- App shell: [`src/App.tsx`](./src/App.tsx)
- Persistence helpers: [`src/lib/persistence.ts`](./src/lib/persistence.ts)
- Native bridge contract: [`src/lib/androidBridge.ts`](./src/lib/androidBridge.ts)
- Capacitor config: [`capacitor.config.ts`](./capacitor.config.ts)
- Android bridge plugin: [`android/app/src/main/java/com/badeparday/excalidrawpersonal/DrawBridgePlugin.java`](./android/app/src/main/java/com/badeparday/excalidrawpersonal/DrawBridgePlugin.java)
- Android activity: [`android/app/src/main/java/com/badeparday/excalidrawpersonal/MainActivity.java`](./android/app/src/main/java/com/badeparday/excalidrawpersonal/MainActivity.java)
- Android manifest: [`android/app/src/main/AndroidManifest.xml`](./android/app/src/main/AndroidManifest.xml)

## Verification Completed

- `npm run build`
- `npm run android:sync`
- `cd android && ANDROID_HOME=/home/badeparday/Android/Sdk ANDROID_SDK_ROOT=/home/badeparday/Android/Sdk JAVA_HOME=/opt/android-studio/jbr ./gradlew assembleDebug`
