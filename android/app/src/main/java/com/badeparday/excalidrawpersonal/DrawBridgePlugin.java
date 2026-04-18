package com.badeparday.excalidrawpersonal;

import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.MotionEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(name = "DrawBridge")
public class DrawBridgePlugin extends Plugin {
    private static final Object LOCK = new Object();
    private static final int MAX_IMPORT_BYTES = 8 * 1024 * 1024;
    private static final String DOCUMENTS_AUTHORITY = "com.android.externalstorage.documents";
    private static final String APP_STORAGE_FOLDER = "Excalidraw";
    private static final String APP_STORAGE_DOCUMENT_ID = "primary:Documents/" + APP_STORAGE_FOLDER;
    private static final String DOCUMENTS_DOCUMENT_ID = "primary:Documents";
    private static final String[] PREFERRED_DOCUMENT_UI_PACKAGES = new String[] {
        "com.google.android.documentsui",
        "com.android.documentsui"
    };
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

    @PluginMethod
    public void openStorageDirectory(PluginCall call) {
        JSObject result = new JSObject();

        try {
            ensureUserStorageDirectory();

            Uri documentUri = DocumentsContract.buildDocumentUri(
                DOCUMENTS_AUTHORITY,
                APP_STORAGE_DOCUMENT_ID
            );
            Uri treeUri = DocumentsContract.buildTreeDocumentUri(
                DOCUMENTS_AUTHORITY,
                APP_STORAGE_DOCUMENT_ID
            );
            Uri parentDocumentUri = DocumentsContract.buildDocumentUri(
                DOCUMENTS_AUTHORITY,
                DOCUMENTS_DOCUMENT_ID
            );
            Uri parentTreeUri = DocumentsContract.buildTreeDocumentUri(
                DOCUMENTS_AUTHORITY,
                DOCUMENTS_DOCUMENT_ID
            );

            Intent viewDocumentIntent = new Intent(Intent.ACTION_VIEW);
            viewDocumentIntent.addCategory(Intent.CATEGORY_DEFAULT);
            viewDocumentIntent.setDataAndType(
                documentUri,
                DocumentsContract.Document.MIME_TYPE_DIR
            );
            viewDocumentIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            viewDocumentIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            viewDocumentIntent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);

            Intent viewTreeIntent = new Intent(Intent.ACTION_VIEW);
            viewTreeIntent.addCategory(Intent.CATEGORY_DEFAULT);
            viewTreeIntent.setDataAndType(treeUri, DocumentsContract.Document.MIME_TYPE_DIR);
            viewTreeIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            viewTreeIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            viewTreeIntent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);

            Intent openTreeAtDirectoryIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            openTreeAtDirectoryIntent.addCategory(Intent.CATEGORY_DEFAULT);
            openTreeAtDirectoryIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            openTreeAtDirectoryIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            openTreeAtDirectoryIntent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            openTreeAtDirectoryIntent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                openTreeAtDirectoryIntent.putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    documentUri
                );
            }

            Intent openTreeAtDirectoryTreeIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            openTreeAtDirectoryTreeIntent.addCategory(Intent.CATEGORY_DEFAULT);
            openTreeAtDirectoryTreeIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            openTreeAtDirectoryTreeIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            openTreeAtDirectoryTreeIntent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            openTreeAtDirectoryTreeIntent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                openTreeAtDirectoryTreeIntent.putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    treeUri
                );
            }

            Intent openTreeAtParentIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            openTreeAtParentIntent.addCategory(Intent.CATEGORY_DEFAULT);
            openTreeAtParentIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            openTreeAtParentIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            openTreeAtParentIntent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            openTreeAtParentIntent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                openTreeAtParentIntent.putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    parentDocumentUri
                );
            }

            Intent openTreeAtParentTreeIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            openTreeAtParentTreeIntent.addCategory(Intent.CATEGORY_DEFAULT);
            openTreeAtParentTreeIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            openTreeAtParentTreeIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            openTreeAtParentTreeIntent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            openTreeAtParentTreeIntent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                openTreeAtParentTreeIntent.putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    parentTreeUri
                );
            }

            Intent[] candidates = new Intent[] {
                viewDocumentIntent,
                viewTreeIntent,
                openTreeAtDirectoryIntent,
                openTreeAtDirectoryTreeIntent,
                openTreeAtParentIntent,
                openTreeAtParentTreeIntent
            };

            for (Intent candidate : candidates) {
                if (tryStartDirectoryIntent(candidate)) {
                    result.put("opened", true);

                    Uri launchedUri = candidate.getData();
                    if (
                        launchedUri == null &&
                        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ) {
                        Object initialUri = candidate.getParcelableExtra(
                            DocumentsContract.EXTRA_INITIAL_URI
                        );
                        if (initialUri instanceof Uri) {
                            launchedUri = (Uri) initialUri;
                        }
                    }

                    if (launchedUri != null) {
                        result.put("uri", launchedUri.toString());
                    }

                    call.resolve(result);
                    return;
                }
            }

            result.put("opened", false);
            result.put("uri", documentUri.toString());
            result.put("error", "No compatible file explorer activity found.");
            call.resolve(result);
        } catch (Exception exception) {
            result.put("opened", false);
            result.put("error", exception.getMessage());
            call.resolve(result);
        }
    }

    @SuppressWarnings("deprecation")
    private void ensureUserStorageDirectory() throws IOException {
        File documentsDirectory = Environment.getExternalStoragePublicDirectory(
            Environment.DIRECTORY_DOCUMENTS
        );
        File appDirectory = new File(documentsDirectory, APP_STORAGE_FOLDER);

        ensureDirectoryExists(appDirectory);
        ensureDirectoryExists(new File(appDirectory, "canvases"));
        ensureDirectoryExists(new File(appDirectory, "libraries"));
        ensureDirectoryExists(new File(appDirectory, "exports"));
        ensureDirectoryExists(new File(appDirectory, "backups"));
    }

    private void ensureDirectoryExists(File directory) throws IOException {
        if (directory.exists()) {
            if (directory.isDirectory()) {
                return;
            }
            throw new IOException(
                "Storage path exists but is not a directory: " + directory.getAbsolutePath()
            );
        }

        if (!directory.mkdirs() && !directory.isDirectory()) {
            throw new IOException(
                "Unable to create storage directory: " + directory.getAbsolutePath()
            );
        }
    }

    private boolean tryStartDirectoryIntent(Intent intent) {
        for (String packageName : PREFERRED_DOCUMENT_UI_PACKAGES) {
            Intent packageScopedIntent = new Intent(intent);
            packageScopedIntent.setPackage(packageName);
            if (tryStartDirectoryIntentInternal(packageScopedIntent)) {
                return true;
            }
        }

        return tryStartDirectoryIntentInternal(intent);
    }

    private boolean tryStartDirectoryIntentInternal(Intent intent) {
        try {
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }

            return true;
        } catch (ActivityNotFoundException | SecurityException | IllegalArgumentException ignored) {
            return false;
        }
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
        if (
            !Intent.ACTION_VIEW.equals(action)
                && !Intent.ACTION_SEND.equals(action)
                && !Intent.ACTION_SEND_MULTIPLE.equals(action)
        ) {
            return null;
        }

        ArrayList<Uri> uris = new ArrayList<>();
        Uri uri = intent.getData();
        if (uri != null) {
            uris.add(uri);
        }

        if (Intent.ACTION_SEND.equals(action)) {
            Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream instanceof Uri) {
                uris.add((Uri) stream);
            }
        }

        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (streams != null) {
                uris.addAll(streams);
            }
        }

        if (uris.isEmpty()) {
            return null;
        }

        JSArray files = new JSArray();
        JSObject firstPayload = null;

        for (Uri pendingUri : uris) {
            JSObject filePayload = buildPendingFilePayload(context, pendingUri);
            if (filePayload == null) {
                continue;
            }
            if (firstPayload == null) {
                firstPayload = filePayload;
            }
            files.put(filePayload);
        }

        if (firstPayload == null) {
            return null;
        }

        firstPayload.put(
            "action",
            Intent.ACTION_VIEW.equals(action) ? "view" : "send"
        );
        if (files.length() > 1) {
            firstPayload.put("files", files);
        }

        return firstPayload;
    }

    private static JSObject buildPendingFilePayload(Context context, Uri uri) {
        if (!isSupportedUriScheme(uri)) {
            return null;
        }

        ContentResolver resolver = context.getContentResolver();
        long declaredSize = resolveSize(resolver, uri);
        if (declaredSize > MAX_IMPORT_BYTES) {
            return null;
        }

        try {
            String name = sanitizeDisplayName(resolveDisplayName(resolver, uri));
            if (name == null || name.isEmpty()) {
                name = "imported.excalidraw";
            }

            String mimeType = resolver.getType(uri);
            if (mimeType == null || mimeType.isEmpty()) {
                mimeType = guessMimeType(name);
            }

            if (!isSupportedImport(name, mimeType)) {
                return null;
            }

            byte[] data = readAllBytes(resolver, uri, MAX_IMPORT_BYTES);
            if (data == null || data.length == 0) {
                return null;
            }

            boolean isTextPayload = shouldTreatAsText(name, mimeType);

            JSObject payload = new JSObject();
            payload.put("name", name);
            payload.put("mimeType", mimeType);
            payload.put("encoding", isTextPayload ? "utf8" : "base64");
            payload.put("size", data.length);
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

    private static long resolveSize(ContentResolver resolver, Uri uri) {
        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) {
                    return cursor.getLong(sizeColumn);
                }
            }
        } catch (Exception exception) {
            // If size is unavailable we continue with a streaming read.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return -1;
    }

    private static boolean isSupportedUriScheme(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) {
            return false;
        }

        String lowerScheme = scheme.toLowerCase(Locale.ROOT);
        return "content".equals(lowerScheme) || "file".equals(lowerScheme);
    }

    private static String sanitizeDisplayName(String name) {
        if (name == null) {
            return null;
        }

        String cleaned = name.replace('\\', '/');
        cleaned = cleaned.substring(cleaned.lastIndexOf('/') + 1).trim();
        return cleaned.isEmpty() ? null : cleaned;
    }

    private static boolean isSupportedImport(String name, String mimeType) {
        String lowerName = name == null ? "" : name.toLowerCase(Locale.ROOT);
        String lowerMime = mimeType == null ? "" : mimeType.toLowerCase(Locale.ROOT);

        boolean supportedExtension = lowerName.endsWith(".excalidraw")
            || lowerName.endsWith(".excalidrawlib")
            || lowerName.endsWith(".json")
            || lowerName.endsWith(".png")
            || lowerName.endsWith(".jpg")
            || lowerName.endsWith(".jpeg")
            || lowerName.endsWith(".gif")
            || lowerName.endsWith(".webp")
            || lowerName.endsWith(".svg")
            || lowerName.endsWith(".bmp")
            || lowerName.endsWith(".avif");

        boolean supportedMime = lowerMime.contains("json")
            || "application/vnd.excalidrawlib+json".equals(lowerMime)
            || lowerMime.startsWith("image/");

        return supportedExtension || supportedMime;
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
        if (lowerName.endsWith(".png")) {
            return "image/png";
        }
        if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (lowerName.endsWith(".gif")) {
            return "image/gif";
        }
        if (lowerName.endsWith(".webp")) {
            return "image/webp";
        }
        if (lowerName.endsWith(".svg")) {
            return "image/svg+xml";
        }
        if (lowerName.endsWith(".bmp")) {
            return "image/bmp";
        }
        if (lowerName.endsWith(".avif")) {
            return "image/avif";
        }
        return "application/octet-stream";
    }

    private static byte[] readAllBytes(ContentResolver resolver, Uri uri, int maxBytes)
        throws IOException {
        InputStream stream = resolver.openInputStream(uri);
        if (stream == null) {
            return null;
        }

        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int bytesRead;
            int totalBytes = 0;
            while ((bytesRead = stream.read(buffer)) != -1) {
                totalBytes += bytesRead;
                if (totalBytes > maxBytes) {
                    return null;
                }
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
