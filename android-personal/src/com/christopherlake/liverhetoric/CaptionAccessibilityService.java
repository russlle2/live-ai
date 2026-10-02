package com.christopherlake.liverhetoric;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/** Optional bridge for visible, explicitly labelled captions. No audio or generic UI scraping. */
public class CaptionAccessibilityService extends AccessibilityService {
    private static final Set<String> PACKAGES = new HashSet<>(Arrays.asList(
        "com.samsung.android.dialer", "com.samsung.android.incallui", "com.android.incallui"));
    private static volatile boolean enabled, connected;
    private static volatile long captureSession;
    private long lastSession;
    private String previous = "";

    public static void setCaptureEnabled(boolean value) { enabled = value; captureSession++; }
    public static boolean isConnected() { return connected; }

    @Override protected void onServiceConnected() {
        connected = true;
        MainActivity.receiveCaption("", enabled ? "Experimental visible caption capture is enabled." : "Caption service connected. Enable capture inside Live Rhetoric when needed.");
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!enabled || event == null || event.getPackageName() == null || !PACKAGES.contains(event.getPackageName().toString())) return;
        if (lastSession != captureSession) { previous = ""; lastSession = captureSession; }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        try {
            if (root.getPackageName() == null || !PACKAGES.contains(root.getPackageName().toString())) return;
            LinkedHashSet<String> pieces = new LinkedHashSet<>();
            int[] budget = { 350 };
            collect(root, pieces, budget, 0);
            StringBuilder result = new StringBuilder();
            for (String piece : pieces) {
                if (result.length() > 0) result.append('\n');
                result.append(piece);
                if (result.length() > 8000) { result.setLength(8000); break; }
            }
            String text = result.toString().trim();
            if (!enabled || text.isEmpty() || text.equals(previous)) return;
            previous = text;
            MainActivity.receiveCaption(text, "Visible Samsung captions · speaker unknown · experimental");
        } finally { root.recycle(); }
    }

    private void collect(AccessibilityNodeInfo node, LinkedHashSet<String> pieces, int[] budget, int depth) {
        if (!enabled || node == null || budget[0]-- <= 0 || depth > 24 || pieces.size() >= 40) return;
        String id = node.getViewIdResourceName();
        if (node.isVisibleToUser() && id != null) {
            String lowered = id.toLowerCase(Locale.ROOT);
            if ((lowered.contains("caption") || lowered.contains("transcri"))
                && !lowered.contains("button") && !lowered.contains("toolbar") && !lowered.contains("icon")) {
                CharSequence text = node.getText();
                if (text != null) {
                    String value = text.toString().trim();
                    if (!value.isEmpty()) pieces.add(value.length() > 8000 ? value.substring(0, 8000) : value);
                }
            }
        }
        for (int i = 0; i < node.getChildCount() && budget[0] > 0; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                try { collect(child, pieces, budget, depth + 1); }
                finally { child.recycle(); }
            }
        }
    }

    @Override public void onInterrupt() { MainActivity.receiveCaption("", "Caption accessibility service was interrupted."); }
    @Override public void onDestroy() {
        connected = false; enabled = false; previous = "";
        MainActivity.receiveCaption("", "Caption accessibility service disconnected.");
        super.onDestroy();
    }
}
