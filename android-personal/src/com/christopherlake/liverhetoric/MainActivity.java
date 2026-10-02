package com.christopherlake.liverhetoric;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Personal offline UI. Only the fixed loopback inference API may use networking. */
public class MainActivity extends Activity {
    private static final int MIC_PERMISSION = 10, IMPORT_TEXT = 11;
    private static final int IMPORT_LIMIT = 1024 * 1024, PAYLOAD_LIMIT = 64000;
    private static final String ENTRY = "file:///android_asset/index.html";
    private static WeakReference<MainActivity> currentActivity = new WeakReference<>(null);
    private static final Set<String> SETTING_KEYS = new HashSet<>(Arrays.asList(
        "desiredOutcome", "outcome", "settleFor", "acceptable", "unacceptable", "boundaries",
        "tone", "language", "outputLanguage", "mode", "engine", "port", "autoSuggest",
        "maxTokens", "temperature", "goal", "compromise", "scenario", "inputLanguage", "continuous", "allowCompromise"));
    private final ExecutorService inferenceWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService utilityWorker = Executors.newSingleThreadExecutor();
    private final Object generationLock = new Object();
    private WebView web;
    private SharedPreferences preferences;
    private SpeechRecognizer recognizer;
    private String pendingLanguage;
    private boolean speechActive, pageReady;
    private long speechSession;
    private volatile boolean destroyed, foreground;
    private JSONObject pendingImport;
    private volatile Generation activeGeneration;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        currentActivity = new WeakReference<>(this);
        preferences = getSharedPreferences("personal_outcomes", MODE_PRIVATE);
        web = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.setFitsSystemWindows(true);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setDatabaseEnabled(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(false);
        web.addJavascriptInterface(new NativeBridge(), "Native");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("file:///android_asset/") && !url.contains("..")) return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!ENTRY.equals(url)) return;
                pageReady = true;
                if (pendingImport != null) { emit(pendingImport); pendingImport = null; }
            }
        });
        web.loadUrl(ENTRY);
        handleShare(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShare(intent);
    }

    @Override protected void onStart() {
        super.onStart();
        foreground = true;
    }

    @Override protected void onStop() {
        foreground = false;
        stopSpeech(true);
        cancelCurrent();
        super.onStop();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        pageReady = false;
        pendingImport = null;
        pendingLanguage = null;
        stopSpeech(false);
        cancelCurrent();
        if (currentActivity.get() == this) {
            currentActivity.clear();
            CaptionAccessibilityService.setCaptureEnabled(false);
        }
        inferenceWorker.shutdownNow();
        utilityWorker.shutdownNow();
        if (web != null) { web.removeJavascriptInterface("Native"); web.destroy(); web = null; }
        super.onDestroy();
    }

    private static JSONObject event(String type) {
        JSONObject object = new JSONObject();
        put(object, "type", type);
        return object;
    }

    private static void put(JSONObject object, String name, Object value) {
        try { object.put(name, value); } catch (Exception ignored) { }
    }

    private void emit(final JSONObject object) {
        runOnUiThread(new Runnable() { @Override public void run() {
            if (destroyed || !pageReady || web == null) return;
            String json = object.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
            web.evaluateJavascript("if(window.NativeEvent){window.NativeEvent(" + json + ");}", null);
        }});
    }

    static void receiveCaption(String text, String status) {
        MainActivity activity = currentActivity.get();
        if (activity == null || activity.destroyed) return;
        JSONObject object = event("caption");
        put(object, "text", text == null ? "" : text);
        put(object, "status", status);
        activity.emit(object);
    }

    private boolean speechAvailable() {
        if (Build.VERSION.SDK_INT < 31) return false;
        try { return SpeechRecognizer.isOnDeviceRecognitionAvailable(this); }
        catch (Exception ignored) { return false; }
    }

    public class NativeBridge {
        @JavascriptInterface public String capabilities() {
            JSONObject object = new JSONObject();
            put(object, "speechAvailable", speechAvailable());
            put(object, "sdk", Build.VERSION.SDK_INT);
            put(object, "version", "0.1.0");
            put(object, "captionExperimental", true);
            put(object, "captionServiceEnabled", CaptionAccessibilityService.isConnected());
            return object.toString();
        }
        @JavascriptInterface public void startListening(String language) {
            final String selected = language != null && language.matches("[A-Za-z0-9-]{2,35}") ? language : Locale.getDefault().toLanguageTag();
            runOnUiThread(new Runnable() { @Override public void run() { beginSpeech(selected); }});
        }
        @JavascriptInterface public void stopListening() { runOnUiThread(new Runnable() { @Override public void run() { stopSpeech(true); }}); }
        @JavascriptInterface public void generate(String payloadJson) { queueGeneration(payloadJson); }
        @JavascriptInterface public void cancelGeneration() { cancelCurrent(); }
        @JavascriptInterface public void checkEngine(int port) { queueEngineCheck(port); }
        @JavascriptInterface public void importText() {
            runOnUiThread(new Runnable() { @Override public void run() {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/plain", "text/vtt", "application/x-subrip", "text/srt"});
                try { startActivityForResult(intent, IMPORT_TEXT); }
                catch (Exception e) { importError("No text document picker is available."); }
            }});
        }
        @JavascriptInterface public void copyText(String text) {
            if (text == null || text.length() > PAYLOAD_LIMIT) return;
            runOnUiThread(new Runnable() { @Override public void run() {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("Live Rhetoric", text));
            }});
        }
        @JavascriptInterface public String loadSettings() { return preferences.getString("settings", "{}"); }
        @JavascriptInterface public void saveSettings(String json) {
            if (json == null || json.length() > 12000) return;
            try {
                JSONObject source = new JSONObject(json), safe = new JSONObject();
                Iterator<String> keys = source.keys();
                while (keys.hasNext()) {
                    String key = keys.next(); Object value = source.get(key);
                    if (SETTING_KEYS.contains(key) && (value instanceof String || value instanceof Number || value instanceof Boolean)) {
                        if (!(value instanceof String) || ((String) value).length() <= 2500) safe.put(key, value);
                    }
                }
                preferences.edit().putString("settings", safe.toString()).apply();
            } catch (Exception ignored) { }
        }
        @JavascriptInterface public void openCaptionSettings() {
            runOnUiThread(new Runnable() { @Override public void run() {
                try { startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)); }
                catch (Exception e) { receiveCaption("", "Accessibility settings could not be opened."); }
            }});
        }
        @JavascriptInterface public void setCaptionCapture(boolean enabled) {
            CaptionAccessibilityService.setCaptureEnabled(enabled);
            receiveCaption("", enabled ? (CaptionAccessibilityService.isConnected() ? "Experimental capture enabled. Only visible caption/transcription fields are read; speaker is unknown." : "Enable the Live Rhetoric accessibility service in Android Settings, then show Samsung call captions. Compatibility is not guaranteed.") : "Caption capture stopped.");
        }
    }

    private void speechEvent(String phase, String text, String message) {
        JSONObject object = event("speech");
        put(object, "phase", phase); put(object, "text", text == null ? "" : text);
        if (message != null) put(object, "message", message);
        emit(object);
    }

    private void beginSpeech(String language) {
        if (destroyed) return;
        if (!foreground) {
            speechEvent("stopped", "", "Microphone remains stopped while the app is in the background.");
            return;
        }
        if (!speechAvailable()) {
            speechEvent("error", "", "On-device speech recognition is unavailable. Type, paste, import, or use visible captions. No cloud recognizer was started.");
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingLanguage = language;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION);
            return;
        }
        stopSpeech(false);
        try {
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
            speechActive = true;
            final long recognitionSession = ++speechSession;
            recognizer.setRecognitionListener(new RecognitionListener() {
                private boolean isCurrent() { return speechActive && recognitionSession == speechSession; }
                public void onReadyForSpeech(Bundle params) { if (isCurrent()) speechEvent("listening", "", "Listening for one utterance on this device."); }
                public void onBeginningOfSpeech() { if (!isCurrent()) return; }
                public void onRmsChanged(float rmsdB) { if (!isCurrent()) return; }
                public void onBufferReceived(byte[] buffer) { if (!isCurrent()) return; }
                public void onEndOfSpeech() { if (!isCurrent()) return; }
                public void onError(int error) {
                    if (!isCurrent()) return;
                    String message;
                    switch (error) {
                        case SpeechRecognizer.ERROR_NO_MATCH: message = "No speech recognized. Tap Listen to try again."; break;
                        case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: message = "No speech heard. Tap Listen to try again."; break;
                        case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: message = "The on-device recognizer is busy."; break;
                        case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: message = "Microphone permission is required for Listen."; break;
                        case 12: message = "This language is not supported by the on-device recognizer."; break;
                        case 13: message = "This language needs an on-device speech pack. Install it in your phone's speech settings."; break;
                        default: message = "On-device recognition could not finish (code " + error + "). No cloud fallback was used.";
                    }
                    stopSpeech(false);
                    speechEvent("error", "", message);
                }
                public void onResults(Bundle results) {
                    if (!isCurrent()) return;
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String text = matches == null || matches.isEmpty() ? "" : matches.get(0);
                    stopSpeech(false);
                    speechEvent("final", text, null);
                }
                public void onPartialResults(Bundle results) {
                    if (!isCurrent()) return;
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) speechEvent("partial", matches.get(0), null);
                }
                public void onEvent(int eventType, Bundle params) { if (!isCurrent()) return; }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            speechEvent("listening", "", "Starting on-device speech recognition.");
            recognizer.startListening(intent);
        } catch (Exception e) {
            stopSpeech(false);
            speechEvent("error", "", "The on-device recognizer could not start. No cloud fallback was used.");
        }
    }

    private void stopSpeech(boolean notify) {
        pendingLanguage = null;
        speechSession++;
        boolean wasActive = speechActive;
        speechActive = false;
        if (recognizer != null) {
            try { recognizer.cancel(); recognizer.destroy(); } catch (Exception ignored) { }
            recognizer = null;
        }
        if (notify && wasActive) speechEvent("stopped", "", "Microphone stopped.");
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != MIC_PERMISSION) return;
        String language = pendingLanguage; pendingLanguage = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED && language != null) beginSpeech(language);
        else speechEvent("error", "", "Microphone permission was not granted. You can still type, paste, or import text.");
    }

    private static boolean allowedPort(int port) { return port == 8080 || port == 8081; }

    private HttpURLConnection connection(int port, String path) throws Exception {
        if (!allowedPort(port)) throw new Exception("Only local engine ports 8080 and 8081 are supported.");
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setConnectTimeout(4000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        return connection;
    }

    private static final class Generation {
        final String requestId;
        final long startedAt = android.os.SystemClock.elapsedRealtime();
        final AtomicBoolean ended = new AtomicBoolean(false);
        volatile boolean cancelled;
        volatile boolean truncated;
        volatile String finishReason = "";
        volatile HttpURLConnection connection;
        Generation(String requestId) { this.requestId = requestId; }
    }

    private void generationEvent(Generation generation, String phase, String text, String message) {
        boolean terminal = phase.equals("done") || phase.equals("error") || phase.equals("cancelled");
        if (terminal && !generation.ended.compareAndSet(false, true)) return;
        if (!terminal && generation.ended.get()) return;
        JSONObject object = event("generation");
        put(object, "requestId", generation.requestId); put(object, "phase", phase);
        put(object, "elapsedMs", android.os.SystemClock.elapsedRealtime() - generation.startedAt);
        if (text != null) put(object, "text", text);
        if (message != null) put(object, "message", message);
        if (phase.equals("done")) {
            put(object, "truncated", generation.truncated);
            put(object, "finish_reason", generation.finishReason);
        }
        emit(object);
    }

    private void cancelCurrent() {
        Generation current;
        synchronized (generationLock) {
            current = activeGeneration;
            activeGeneration = null;
            if (current != null) current.cancelled = true;
        }
        if (current != null) {
            if (current.connection != null) current.connection.disconnect();
            generationEvent(current, "cancelled", null, "Generation cancelled.");
        }
    }

    private void queueGeneration(String raw) {
        String requestId = "invalid";
        try {
            if (raw == null || raw.length() > PAYLOAD_LIMIT) throw new Exception("Request is too large.");
            JSONObject input = new JSONObject(raw);
            requestId = input.optString("requestId", "request");
            if (requestId.length() > 100) throw new Exception("Invalid request ID.");
            if (destroyed || !foreground) throw new Exception("Open Live Rhetoric to generate a suggestion.");
            int port = input.optInt("port", 8081);
            if (!allowedPort(port)) throw new Exception("Only local engine ports 8080 and 8081 are supported.");
            JSONArray messages = input.optJSONArray("messages");
            if (messages == null || messages.length() == 0 || messages.length() > 32) throw new Exception("Use between 1 and 32 messages.");
            JSONArray safeMessages = new JSONArray();
            int total = 0;
            for (int i = 0; i < messages.length(); i++) {
                JSONObject source = messages.getJSONObject(i);
                String role = source.optString("role"), content = source.optString("content");
                if (!role.equals("system") && !role.equals("user") && !role.equals("assistant")) throw new Exception("Unsupported message role.");
                total += content.length();
                if (content.length() > 30000 || total > 45000) throw new Exception("Conversation is too long for a live request.");
                JSONObject message = new JSONObject(); message.put("role", role); message.put("content", content);
                safeMessages.put(message);
            }
            JSONObject body = new JSONObject();
            body.put("messages", safeMessages); body.put("stream", true);
            body.put("max_tokens", Math.max(16, Math.min(512, input.optInt("max_tokens", 180))));
            body.put("temperature", Math.max(0.0, Math.min(1.5, input.optDouble("temperature", 0.5))));
            body.put("chat_template_kwargs", new JSONObject().put("enable_thinking", false));
            final Generation generation = new Generation(requestId);
            cancelCurrent();
            synchronized (generationLock) { activeGeneration = generation; }
            inferenceWorker.execute(new Runnable() { @Override public void run() { runGeneration(generation, port, body); }});
        } catch (Exception e) {
            generationEvent(new Generation(requestId), "error", null, e.getMessage() == null ? "Invalid generation request." : e.getMessage());
        }
    }

    private void runGeneration(Generation generation, int port, JSONObject body) {
        if (generation.cancelled || destroyed) return;
        HttpURLConnection connection = null;
        StringBuilder full = new StringBuilder();
        try {
            generationEvent(generation, "start", "", null);
            connection = connection(port, "/v1/chat/completions");
            generation.connection = connection;
            if (generation.cancelled) return;
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "text/event-stream");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            int code = connection.getResponseCode();
            if (code != 200) throw new Exception("Local engine returned HTTP " + code + ". Check its Termux window.");
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                boolean completed = false;
                while (!generation.cancelled && (line = readBoundedLine(reader, PAYLOAD_LIMIT)) != null) {
                    if (!line.startsWith("data:")) continue;
                    String data = line.substring(5).trim();
                    if (data.equals("[DONE]")) { completed = true; break; }
                    if (data.isEmpty()) continue;
                    JSONObject chunk = new JSONObject(data);
                    if (chunk.has("error")) throw new Exception("Local engine could not complete this request.");
                    JSONArray choices = chunk.optJSONArray("choices");
                    if (choices == null || choices.length() == 0) continue;
                    JSONObject choice = choices.getJSONObject(0), delta = choice.optJSONObject("delta");
                    if (delta != null && !delta.isNull("content")) {
                        String text = delta.optString("content", "");
                        if (!text.isEmpty()) {
                            full.append(text);
                            if (full.length() > PAYLOAD_LIMIT) throw new Exception("Local response exceeded the size limit.");
                            generationEvent(generation, "delta", text, null);
                        }
                    }
                    if (!choice.isNull("finish_reason") && !choice.optString("finish_reason").isEmpty()) {
                        generation.finishReason = choice.optString("finish_reason");
                        generation.truncated = generation.finishReason.equals("length");
                        completed = true;
                    }
                }
                if (!generation.cancelled) {
                    if (!completed) throw new Exception("The local engine stream ended before completion.");
                    generationEvent(generation, "done", full.toString(), generation.truncated
                        ? "Response reached its token limit and may be incomplete. Use a shorter utterance or generate again."
                        : null);
                }
            }
        } catch (Exception e) {
            if (!generation.cancelled) {
                String message = e.getMessage();
                if (e instanceof java.net.ConnectException) message = "Local engine is not running on port " + port + ". Start it in Termux.";
                else if (e instanceof java.net.SocketTimeoutException) message = "The local engine timed out. Try a shorter conversation excerpt.";
                generationEvent(generation, "error", null, message == null ? "Local engine request failed." : message);
            }
        } finally {
            if (connection != null) connection.disconnect();
            generation.connection = null;
            synchronized (generationLock) { if (activeGeneration == generation) activeGeneration = null; }
        }
    }

    private static String readBoundedLine(BufferedReader reader, int limit) throws Exception {
        StringBuilder line = new StringBuilder(); int value;
        while ((value = reader.read()) != -1) {
            if (value == '\n') return line.toString();
            if (value != '\r') line.append((char) value);
            if (line.length() > limit) throw new Exception("Local engine sent an oversized event.");
        }
        return line.length() == 0 ? null : line.toString();
    }

    private void queueEngineCheck(int port) {
        if (!allowedPort(port)) {
            engineEvent(port, false, "", "Only local ports 8080 and 8081 are supported."); return;
        }
        utilityWorker.execute(new Runnable() { @Override public void run() {
            HttpURLConnection connection = null;
            try {
                connection = connection(port, "/health");
                connection.setReadTimeout(4000);
                int code = connection.getResponseCode();
                if (code != 200) {
                    engineEvent(port, false, "", code == 503 ? "Model is still loading in Termux." : "Engine health check returned HTTP " + code + ".");
                    return;
                }
                connection.disconnect();
                connection = connection(port, "/v1/models"); connection.setReadTimeout(4000);
                String model = port == 8081 ? "Fast local model" : "Custom local model";
                if (connection.getResponseCode() == 200) {
                    String json = readTextLimited(connection.getInputStream(), 32768);
                    JSONArray models = new JSONObject(json).optJSONArray("data");
                    if (models != null && models.length() > 0) model = models.getJSONObject(0).optString("id", model);
                }
                engineEvent(port, true, model, "Local engine is ready.");
            } catch (Exception e) { engineEvent(port, false, "", "No ready local engine on port " + port + ". Start it in Termux."); }
            finally { if (connection != null) connection.disconnect(); }
        }});
    }

    private void engineEvent(int port, boolean ready, String model, String message) {
        JSONObject object = event("engine");
        put(object, "port", port); put(object, "ready", ready); put(object, "model", model); put(object, "message", message); emit(object);
    }

    private static String readTextLimited(InputStream input, int limit) throws Exception {
        if (input == null) throw new Exception("Cannot open this document.");
        try (InputStream stream = input; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = stream.read(buffer)) != -1) {
                if (bytes.size() + count > limit) throw new Exception("Text file is too large; use a file smaller than 1 MB.");
                bytes.write(buffer, 0, count);
            }
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
            if (text.indexOf('\0') >= 0) throw new Exception("This appears to be a binary file. Choose UTF-8 text.");
            return text;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == IMPORT_TEXT && resultCode == RESULT_OK && data != null && data.getData() != null) importUri(data.getData());
    }

    private void handleShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text != null && text.length() > 0) {
            if (text.length() > IMPORT_LIMIT) importError("Shared text is too large. Share a shorter section.");
            else deliverImport(text.toString(), "Shared text");
            return;
        }
        Uri uri;
        if (Build.VERSION.SDK_INT >= 33) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        else uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri != null) importUri(uri);
    }

    private void importUri(Uri uri) {
        if (!"content".equals(uri.getScheme())) { importError("Choose a text document through Android's file picker."); return; }
        utilityWorker.execute(new Runnable() { @Override public void run() {
            try {
                String name = "Imported text";
                try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                if (name == null) name = "Imported text";
                String mime = getContentResolver().getType(uri), lower = name.toLowerCase(Locale.ROOT);
                boolean valid = mime != null && (mime.startsWith("text/") || mime.equals("application/x-subrip"));
                valid = valid || lower.endsWith(".txt") || lower.endsWith(".srt") || lower.endsWith(".vtt");
                if (!valid) throw new Exception("Choose a .txt, .srt, or .vtt text file.");
                String text = readTextLimited(getContentResolver().openInputStream(uri), IMPORT_LIMIT);
                deliverImport(text, name);
            } catch (Exception e) { importError(e.getMessage() == null ? "This text file could not be opened." : e.getMessage()); }
        }});
    }

    private void deliverImport(String text, String source) {
        JSONObject object = event("import"); put(object, "text", text); put(object, "source", source);
        runOnUiThread(new Runnable() { @Override public void run() { if (pageReady) emit(object); else pendingImport = object; }});
    }

    private void importError(String message) {
        JSONObject object = event("import"); put(object, "text", ""); put(object, "source", ""); put(object, "message", message);
        runOnUiThread(new Runnable() { @Override public void run() { if (pageReady) emit(object); else pendingImport = object; }});
    }
}
