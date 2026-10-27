package co.agentifyerp.app;

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

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        keepContentClearOfSystemBars();
        handleBackInsideApp();
    }

    /** Android 15 draws apps edge to edge; keep the web app below the status bar and above the gesture bar / keyboard. */
    private void keepContentClearOfSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(true);
        controller.setAppearanceLightNavigationBars(true);
        View root = findViewById(android.R.id.content);
        root.setBackgroundColor(Color.parseColor("#f4f9f7"));
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
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
