# Mobile app

The ERP is a full **installable PWA** (manifest, service worker, push notifications, bottom-tab phone layout). This works with nothing to build:

- **Android (Chrome):** open the ERP URL over HTTPS → menu → *Install app* (or tap the in-app "Install" bar).
- **iPhone (Safari):** Share → *Add to Home Screen*. Push notifications on iOS require iOS 16.4+ and the app installed to the home screen.

> Web-push requires HTTPS (or `localhost`). Deploy behind TLS for phones to receive the daily goal reminders.

## Try it on your phone right now (same Wi-Fi as this computer)

1. Start the server (`npm start`) and find this computer's address (`ipconfig` → *IPv4 Address*, e.g. `192.168.18.97`).
2. On the phone's browser open `http://<that address>:4000` — the whole ERP, the customer portal (`/portal/login`) and the public website (`/site`) work, laid out for the phone with the bottom tabs.
3. Android Chrome: menu → *Add to Home screen*. iPhone Safari: Share → *Add to Home Screen*.

**Important:** installing it as a full app (offline start, push notifications such as the daily goal reminders) needs **HTTPS**. Plain `http://192.168…` gives you the home-screen shortcut only. For real use put the ERP on a server with a domain and HTTPS, or for a quick test run a free tunnel such as `cloudflared tunnel --url http://localhost:4000`, which gives a temporary `https://…` address.

## Store-ready Android / iOS apps (Capacitor wrapper)

This folder wraps the hosted ERP in a native shell so you can publish to Google Play / the App Store.
**An APK/IPA cannot be produced from this repository alone** — it needs Android Studio / Xcode on your machine.

1. Deploy the ERP on an HTTPS domain, then replace `YOUR-ERP-DOMAIN.example` in `capacitor.config.json` and `www/index.html`.
2. `cd mobile && npm install`
3. `npm run add:android` (and/or `npm run add:ios` on a Mac), then `npm run sync`
4. `npm run open:android` → build/sign the APK or AAB in Android Studio (iOS: Xcode).
5. Replace the generated launcher icons with `client/public/icon-512.png`.

## Android app file (built and served)

`client/public/downloads/agentify-erp.apk` is a debug-signed build of this wrapper (app id `co.agentifyerp.app`, loads https://agentifyerp.co) and is served at `/downloads/agentify-erp.apk`; the landing page and the workspace "Download app" buttons link to it on Android.

Rebuild after changing the wrapper (JDK 17 and the Android SDK, platform 35, must be installed):

```
cd mobile && npm install && npx cap sync android
cd android && ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../../client/public/downloads/agentify-erp.apk
```

For Google Play see **PLAY_STORE.md** (Capacitor 7 / API 35, signing with your own upload key, Data safety answers, policy risks). JDK 17+ and Android SDK platform 35 are needed now. iOS needs a Mac with Xcode (`npm run add:ios`).
