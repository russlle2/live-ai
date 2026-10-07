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
    private static final int CAPTION_LIMIT = 6000;
    private static final Set<String> PACKAGES = new HashSet<>(Arrays.asList(
        "com.samsung.android.dialer", "com.samsung.android.incallui", "com.android.incallui"));
    private static volatile boolean enabled, connected;
    private static volatile long captureSession;
    private long lastSession;
    private String previous = "";
    private boolean previousOverflow;

    public static void setCaptureEnabled(boolean value) { enabled = value; captureSession++; }
    public static boolean isConnected() { return connected; }

    @Override protected void onServiceConnected() {
        connected = true;
        MainActivity.receiveCaption("", enabled ? "Experimental visible caption capture is enabled." : "Caption service connected. Enable capture inside Live Rhetoric when needed.");
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!enabled || event == null || event.getPackageName() == null || !PACKAGES.contains(event.getPackageName().toString())) return;
        if (lastSession != captureSession) { previous = ""; previousOverflow = false; lastSession = captureSession; }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        try {
            if (root.getPackageName() == null || !PACKAGES.contains(root.getPackageName().toString())) return;
            LinkedHashSet<String> pieces = new LinkedHashSet<>();
            int[] budget = { 350 };
            int[] textLength = { 0 };
            boolean[] overflow = { false };
            collect(root, pieces, budget, textLength, overflow, 0);
            if (overflow[0]) {
                if (enabled && !previousOverflow) {
                    previous = "";
                    previousOverflow = true;
                    MainActivity.receiveCaption("", "The visible caption view exceeds the safe capture limit. Copy and review an excerpt of at most 6,000 characters before requesting guidance.", true);
                }
                return;
            }
            StringBuilder result = new StringBuilder();
            for (String piece : pieces) {
                if (result.length() > 0) result.append('\n');
                result.append(piece);
            }
            String text = result.toString().trim();
            if (!enabled || text.isEmpty() || (!previousOverflow && text.equals(previous))) return;
            previous = text;
            previousOverflow = false;
            MainActivity.receiveCaption(text, "Visible Samsung captions · speaker unknown · experimental");
        } finally { root.recycle(); }
    }

    private void collect(AccessibilityNodeInfo node, LinkedHashSet<String> pieces, int[] budget, int[] textLength, boolean[] overflow, int depth) {
        if (!enabled || overflow[0] || node == null) return;
        if (budget[0]-- <= 0 || depth > 24) { overflow[0] = true; return; }
        String id = node.getViewIdResourceName();
        if (node.isVisibleToUser() && id != null) {
            String lowered = id.toLowerCase(Locale.ROOT);
            if ((lowered.contains("caption") || lowered.contains("transcri"))
                && !lowered.contains("button") && !lowered.contains("toolbar") && !lowered.contains("icon")) {
                CharSequence text = node.getText();
                if (text != null) {
                    // Reject excess before copying; never silently cut conditions or numbers.
                    if (text.length() > CAPTION_LIMIT) { overflow[0] = true; return; }
                    String value = text.toString().trim();
                    if (!value.isEmpty() && !pieces.contains(value)) {
                        int combinedLength = textLength[0] + value.length() + (pieces.isEmpty() ? 0 : 1);
                        if (combinedLength > CAPTION_LIMIT) { overflow[0] = true; return; }
                        pieces.add(value);
                        textLength[0] = combinedLength;
                    }
                }
            }
        }
        for (int i = 0; i < node.getChildCount() && !overflow[0]; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                try { collect(child, pieces, budget, textLength, overflow, depth + 1); }
                finally { child.recycle(); }
            }
        }
    }

    @Override public void onInterrupt() { MainActivity.receiveCaption("", "Caption accessibility service was interrupted."); }
    @Override public void onDestroy() {
        connected = false; enabled = false; previous = ""; previousOverflow = false;
        MainActivity.receiveCaption("", "Caption accessibility service disconnected.");
        super.onDestroy();
    }
}
