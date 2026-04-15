package com.badeparday.excalidrawpersonal;

import android.content.Intent;
import android.os.Bundle;
import android.view.MotionEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DrawBridgePlugin.class);
        super.onCreate(savedInstanceState);
        DrawBridgePlugin.pushPendingOpen(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        DrawBridgePlugin.pushPendingOpen(this, intent);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        DrawBridgePlugin.pushStylusSnapshot(event);
        return super.dispatchTouchEvent(event);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        DrawBridgePlugin.pushStylusSnapshot(event);
        return super.dispatchGenericMotionEvent(event);
    }
}
