package com.badeparday.excalidrawpersonal;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.MotionEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

@CapacitorPlugin(name = "DrawBridge")
public class DrawBridgePlugin extends Plugin {
    private static final Object LOCK = new Object();
    private static DrawBridgePlugin instance;
    private static JSObject pendingOpenPayload;
    private static JSObject latestStylusSnapshot;

    @Override
    public void load() {
        synchronized (LOCK) {
            instance = this;
        }
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (LOCK) {
            if (instance == this) {
                instance = null;
            }
        }
    }

    @PluginMethod
    public void getPendingOpen(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (LOCK) {
            if (pendingOpenPayload != null) {
                result.put("pendingOpen", pendingOpenPayload);
            }
        }
        call.resolve(result);
    }

    @PluginMethod
    public void clearPendingOpen(PluginCall call) {
        synchronized (LOCK) {
            pendingOpenPayload = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void getStylusSnapshot(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (LOCK) {
            if (latestStylusSnapshot != null) {
                result.put("stylus", latestStylusSnapshot);
            }
        }
        call.resolve(result);
    }

    public static void pushPendingOpen(Context context, Intent intent) {
        JSObject payload = buildPendingOpenPayload(context, intent);
        if (payload == null) {
            return;
        }

        synchronized (LOCK) {
            pendingOpenPayload = payload;

            if (instance != null) {
                JSObject event = new JSObject();
                event.put("pendingOpen", payload);
                instance.notifyListeners("intentOpen", event, true);
            }
        }
    }

    public static void pushStylusSnapshot(MotionEvent event) {
        JSObject snapshot = buildStylusSnapshot(event);
        if (snapshot == null) {
            return;
        }

        synchronized (LOCK) {
            if (isSimilarSnapshot(snapshot, latestStylusSnapshot)) {
                return;
            }

            latestStylusSnapshot = snapshot;

            if (instance != null) {
                JSObject pluginEvent = new JSObject();
                pluginEvent.put("stylus", snapshot);
                instance.notifyListeners("stylusChange", pluginEvent, true);
            }
        }
    }

    private static JSObject buildPendingOpenPayload(Context context, Intent intent) {
        if (intent == null) {
            return null;
        }

        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action)) {
            return null;
        }

        Uri uri = intent.getData();
        if (uri == null && Intent.ACTION_SEND.equals(action)) {
            Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream instanceof Uri) {
                uri = (Uri) stream;
            }
        }

        if (uri == null) {
            return null;
        }

        try {
            byte[] data = readAllBytes(context.getContentResolver(), uri);
            if (data == null || data.length == 0) {
                return null;
            }

            String name = resolveDisplayName(context.getContentResolver(), uri);
            if (name == null || name.isEmpty()) {
                name = "imported.excalidraw";
            }

            String mimeType = context.getContentResolver().getType(uri);
            if (mimeType == null || mimeType.isEmpty()) {
                mimeType = guessMimeType(name);
            }

            boolean isTextPayload = shouldTreatAsText(name, mimeType);

            JSObject payload = new JSObject();
            payload.put("name", name);
            payload.put("mimeType", mimeType);
            payload.put("action", Intent.ACTION_SEND.equals(action) ? "send" : "view");
            payload.put("encoding", isTextPayload ? "utf8" : "base64");
            payload.put(
                "data",
                isTextPayload
                    ? new String(data, StandardCharsets.UTF_8)
                    : Base64.encodeToString(data, Base64.NO_WRAP)
            );

            return payload;
        } catch (IOException exception) {
            return null;
        }
    }

    private static JSObject buildStylusSnapshot(MotionEvent event) {
        if (event == null || event.getPointerCount() == 0) {
            return null;
        }

        int toolType = event.getToolType(0);
        String mappedToolType = mapToolType(toolType);
        String mappedPointerType = mapPointerType(toolType);

        JSObject snapshot = new JSObject();
        snapshot.put("toolType", mappedToolType);
        snapshot.put("pointerType", mappedPointerType);
        snapshot.put("hovering", isHoverAction(event));
        snapshot.put("pressure", round(event.getPressure(0)));
        snapshot.put("tiltX", round(event.getAxisValue(MotionEvent.AXIS_TILT, 0)));
        snapshot.put("tiltY", round(event.getOrientation()));
        snapshot.put("buttonState", event.getButtonState());
        snapshot.put("timestamp", event.getEventTime());
        return snapshot;
    }

    private static boolean isHoverAction(MotionEvent event) {
        int action = event.getActionMasked();
        return action == MotionEvent.ACTION_HOVER_ENTER
            || action == MotionEvent.ACTION_HOVER_MOVE
            || action == MotionEvent.ACTION_HOVER_EXIT;
    }

    private static boolean isSimilarSnapshot(JSObject next, JSObject previous) {
        if (previous == null) {
            return false;
        }

        return next.optString("toolType").equals(previous.optString("toolType"))
            && next.optString("pointerType").equals(previous.optString("pointerType"))
            && next.optBoolean("hovering") == previous.optBoolean("hovering")
            && next.optInt("buttonState") == previous.optInt("buttonState")
            && Math.abs(next.optDouble("pressure") - previous.optDouble("pressure")) < 0.05
            && Math.abs(next.optDouble("tiltX") - previous.optDouble("tiltX")) < 1.5
            && Math.abs(next.optDouble("tiltY") - previous.optDouble("tiltY")) < 1.5;
    }

    private static String mapToolType(int toolType) {
        switch (toolType) {
            case MotionEvent.TOOL_TYPE_FINGER:
                return "finger";
            case MotionEvent.TOOL_TYPE_STYLUS:
                return "stylus";
            case MotionEvent.TOOL_TYPE_MOUSE:
                return "mouse";
            case MotionEvent.TOOL_TYPE_ERASER:
                return "eraser";
            default:
                return "unknown";
        }
    }

    private static String mapPointerType(int toolType) {
        switch (toolType) {
            case MotionEvent.TOOL_TYPE_STYLUS:
            case MotionEvent.TOOL_TYPE_ERASER:
                return "pen";
            case MotionEvent.TOOL_TYPE_MOUSE:
                return "mouse";
            case MotionEvent.TOOL_TYPE_FINGER:
                return "touch";
            default:
                return "unknown";
        }
    }

    private static String resolveDisplayName(ContentResolver resolver, Uri uri) {
        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameColumn >= 0) {
                    return cursor.getString(nameColumn);
                }
            }
        } catch (Exception exception) {
            // fall through to path parsing
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        String path = uri.getLastPathSegment();
        return path == null ? null : path.substring(path.lastIndexOf('/') + 1);
    }

    private static boolean shouldTreatAsText(String name, String mimeType) {
        String lowerName = name == null ? "" : name.toLowerCase(Locale.ROOT);
        String lowerMime = mimeType == null ? "" : mimeType.toLowerCase(Locale.ROOT);
        return lowerMime.startsWith("text/")
            || lowerMime.contains("json")
            || lowerName.endsWith(".excalidraw")
            || lowerName.endsWith(".excalidrawlib");
    }

    private static String guessMimeType(String name) {
        if (name == null) {
            return "application/octet-stream";
        }

        String lowerName = name.toLowerCase(Locale.ROOT);
        if (lowerName.endsWith(".excalidraw") || lowerName.endsWith(".json")) {
            return "application/json";
        }
        if (lowerName.endsWith(".excalidrawlib")) {
            return "application/vnd.excalidrawlib+json";
        }
        return "application/octet-stream";
    }

    private static byte[] readAllBytes(ContentResolver resolver, Uri uri) throws IOException {
        InputStream stream = resolver.openInputStream(uri);
        if (stream == null) {
            return null;
        }

        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = stream.read(buffer)) != -1) {
                output.write(buffer, 0, bytesRead);
            }
            return output.toByteArray();
        } finally {
            stream.close();
        }
    }

    private static double round(float value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
