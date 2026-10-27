package co.agentifyerp.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Thin shell around https://agentifyerp.co. Everything visible comes from the website, so it updates without a new app
 * file. The few native things the web layer may change (bar colours, recent-apps title, safe-area handling) go through
 * {@link AgentifyShellPlugin}; the last values are remembered here so the next start looks right before the page loads.
 */
public class MainActivity extends BridgeActivity {
    private static final String PREFS = "agentify_shell";
    private int chrome = Color.WHITE;
    private boolean lightIcons = false;
    private String insetsMode = "native";
    private int insetTop, insetRight, insetBottom, insetLeft;
    private View root;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AgentifyShellPlugin.class);
        super.onCreate(savedInstanceState);
        SharedPreferences p = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try { chrome = Color.parseColor(p.getString("chrome", "#ffffff")); } catch (IllegalArgumentException ignored) { chrome = Color.WHITE; }
        lightIcons = p.getBoolean("lightIcons", false);
        insetsMode = p.getString("insets", "native");
        setUpWindow();
        handleBackInsideApp();
    }

    /** Android 15 draws apps edge to edge; the shell keeps the page clear of the bars (or lets the page do it, see insets). */
    private void setUpWindow() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        root = findViewById(android.R.id.content);
        applyChrome();
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            insetTop = bars.top; insetLeft = bars.left; insetRight = bars.right; insetBottom = Math.max(bars.bottom, ime.bottom);
            applyInsets();
            return WindowInsetsCompat.CONSUMED;
        });
    }

    private void applyInsets() {
        if (root == null) return;
        if ("web".equals(insetsMode)) root.setPadding(0, 0, 0, 0);
        else root.setPadding(insetLeft, insetTop, insetRight, insetBottom);
        publishInsets();
    }

    /** Hands the bar sizes to the page as CSS variables (--safe-top ...) so it can lay itself out when insets are "web". */
    void publishInsets() {
        if (bridge == null || bridge.getWebView() == null) return;
        final WebView web = bridge.getWebView();
        final float d = getResources().getDisplayMetrics().density;
        final String js = "(function(){var s=document.documentElement.style;s.setProperty('--safe-top','" + (insetTop / d) + "px');s.setProperty('--safe-right','" + (insetRight / d)
            + "px');s.setProperty('--safe-bottom','" + (insetBottom / d) + "px');s.setProperty('--safe-left','" + (insetLeft / d) + "px');})()";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    int[] insetsDp() {
        float d = getResources().getDisplayMetrics().density;
        return new int[] { Math.round(insetTop / d), Math.round(insetRight / d), Math.round(insetBottom / d), Math.round(insetLeft / d) };
    }

    private void applyChrome() {
        if (root != null) root.setBackgroundColor(chrome);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(!lightIcons);
        c.setAppearanceLightNavigationBars(!lightIcons);
    }

    /** Called by the plugin on the UI thread. Null or invalid values leave the current setting alone. */
    @SuppressWarnings("deprecation")
    void applyAppearance(String chromeHex, String icons, String insets, String title) {
        SharedPreferences.Editor e = getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (chromeHex != null) {
            try { chrome = Color.parseColor(chromeHex); e.putString("chrome", chromeHex); } catch (IllegalArgumentException ignored) { /* keep the old colour */ }
        }
        if ("light".equals(icons) || "dark".equals(icons)) { lightIcons = "light".equals(icons); e.putBoolean("lightIcons", lightIcons); }
        if ("web".equals(insets) || "native".equals(insets)) { insetsMode = insets; e.putString("insets", insetsMode); }
        e.apply();
        applyChrome();
        applyInsets();
        if (title != null && !title.trim().isEmpty()) setTaskDescription(new ActivityManager.TaskDescription(title.trim(), null, chrome));
    }

    /**
     * Back asks the web app first: it closes an open pop-up or menu, or steps back one screen. Only when the web app says
     * it is on the home screen (or is not ready) does Back leave the app.
     */
    private void handleBackInsideApp() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final WebView web = bridge != null ? bridge.getWebView() : null;
                if (web == null) { finish(); return; }
                web.evaluateJavascript("(function(){try{return window.__agentifyBack?window.__agentifyBack():'unknown'}catch(e){return 'unknown'}})()", value -> {
                    String result = value == null ? "" : value.replace("\"", "");
                    if ("handled".equals(result)) return;
                    if ("unknown".equals(result) && web.canGoBack()) { web.goBack(); return; }
                    finish();
                });
            }
        });
    }
}
