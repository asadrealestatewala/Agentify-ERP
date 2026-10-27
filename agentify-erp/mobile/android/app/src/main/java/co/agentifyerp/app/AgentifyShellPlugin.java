package co.agentifyerp.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * The only native surface the web app can call: Capacitor.Plugins.AgentifyShell. Kept small and generic so the web layer
 * can grow without a new app file. Requests come from the pages of agentifyerp.co only (Capacitor's allowNavigation).
 * Permissions: requestPermissions({ permissions: ['camera', 'microphone', 'location', 'notifications'] }) and checkPermissions().
 */
@CapacitorPlugin(name = "AgentifyShell", permissions = {
    @Permission(alias = "camera", strings = { "android.permission.CAMERA" }),
    @Permission(alias = "microphone", strings = { "android.permission.RECORD_AUDIO" }),
    @Permission(alias = "location", strings = { "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION" }),
    @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
})
public class AgentifyShellPlugin extends Plugin {
    /** Bumped only when the methods below change; the web app checks it before calling anything newer. */
    private static final int BRIDGE_VERSION = 1;

    private MainActivity shell() { return (MainActivity) getActivity(); }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject o = new JSObject();
        o.put("bridge", BRIDGE_VERSION);
        o.put("sdk", Build.VERSION.SDK_INT);
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            o.put("versionName", pi.versionName);
            o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
        } catch (Exception e) { o.put("versionCode", 0); }
        call.resolve(o);
    }

    @PluginMethod
    public void getInsets(PluginCall call) {
        int[] i = shell().insetsDp();
        JSObject o = new JSObject();
        o.put("top", i[0]); o.put("right", i[1]); o.put("bottom", i[2]); o.put("left", i[3]);
        call.resolve(o);
    }

    /** { chrome: '#ffffff', icons: 'dark' | 'light', insets: 'native' | 'web', title: 'Agentify ERP' } - every field optional. */
    @PluginMethod
    public void setAppearance(PluginCall call) {
        final String chrome = call.getString("chrome");
        final String icons = call.getString("icons");
        final String insets = call.getString("insets");
        final String title = call.getString("title");
        getActivity().runOnUiThread(() -> { shell().applyAppearance(chrome, icons, insets, title); call.resolve(); });
    }

    /** Opens an https link (the update page, a payment page) in the phone's browser. */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !url.startsWith("https://")) { call.reject("Only https links can be opened"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject("No app can open this link"); }
    }

    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().finish());
        call.resolve();
    }
}
