# Google Play release guide (Agentify ERP, `co.agentifyerp.app`)

The Android app is a Capacitor shell that opens https://agentifyerp.co. Web changes reach the app without a rebuild; only native things (permissions, version, icons, target SDK) need a new build.

## What changed in v1.1.0 (versionCode 2)
- Capacitor 6 → 7, so the app targets **Android 15 (API 35)**; minSdk 23. Google Play rejects new apps and updates below the current target level (API 35 since Aug 2025). Check Play Console > App content for the current level before each release; a newer Capacitor may be needed if it moves to API 36.
- New permissions: `CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` (video meetings, call recording, photo upload). Camera, microphone and GPS are marked optional hardware.
- Already present: `ACCESS_COARSE/FINE_LOCATION`, foreground only (field-agent location, property-visit check-in, GPS auto-fill). No background location, so no background-location declaration is needed.
- `allowBackup=false` (the WebView holds the sign-in session) and cleartext traffic off.
- Release signing is read from `android/keystore.properties` (git-ignored) or `ANDROID_KEYSTORE_*` environment variables.
- The in-app "Download for Android" APK card is hidden inside the store app (Play does not allow an app to offer a second way to install itself).
- How the existing features reach the phone: Capacitor's WebView client already handles the geolocation prompt, camera/microphone requests, the file chooser (uploads, camera capture) and Back (the web `backNav.js` keeps its pop-up/home logic).

## Build the signed bundle (on a PC with JDK 17+ and Android SDK 35)
```
cd mobile && npm install && npx cap sync android
cd android
# one-time: create your OWN upload key (keep it and the passwords outside the repo, and back them up)
keytool -genkeypair -v -keystore ~/agentify-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
# android/keystore.properties (git-ignored):  storeFile=/home/you/agentify-upload.jks  storePassword=...  keyAlias=upload  keyPassword=...
./gradlew bundleRelease          # app/build/outputs/bundle/release/app-release.aab -> upload to Play Console
./gradlew assembleDebug          # test APK for a phone
```
Enrol in **Play App Signing** when creating the app; Google keeps the final signing key and your key is only the upload key. Raise `versionCode` for every upload.
The sideload APK at `/downloads/agentify-erp.apk` is debug-signed; replace it only through a normal PR after the new build has been tried on a phone. Do not publish the store AAB's upload-signed APK as the download.

## Not done / not tested (honest list)
- **Nothing was built or run on a phone.** The cloud sandbox cannot download the Android SDK (dl.google.com is blocked), so the Capacitor 7 / Gradle 8.11 / AGP 8.7 upgrade is untested. Run `bundleRelease` and `assembleDebug` first; fix any Gradle error before anything else.
- Test on a real Android phone: location sharing and visit check-in prompts, video meeting camera/mic, call recording, file/photo upload, Back button, sign-in persistence, links to other sites.

## Play Console checklist
1. **Developer account**: a new *personal* account must run a closed test with at least 12 testers for 14 days before production; organisation accounts do not. Confirm current rules in Play Console.
2. **Privacy policy URL**: https://agentifyerp.co/legal/privacy exists, but its text is still the **placeholder draft**. Replace it with a reviewed policy (data collected, purposes, retention, deletion, contact) in Super Admin > Website builder > Legal before submitting. Play will reject a placeholder.
3. **Account deletion**: apps with sign-up need an in-app deletion path and a public web URL for the request. Today the workspace owner can *request* closure from Billing (platform team processes it). Add a public deletion-request page or URL and say how long it takes.
4. **Data safety form** (draft answers; verify against the final policy):
   - Location: precise, collected for app functionality (field location, visit check-in, property GPS); foreground only; employee consent notice; not sold; optional per workspace.
   - Personal info: name, email, phone, address (contacts/leads and users); account and app functionality.
   - Financial info: payment and invoice records the customer keeps in the ERP; subscription billing.
   - Photos/videos, files and docs, audio (call recordings, meeting audio/video): user-provided, app functionality.
   - App activity and device ids: sign-in sessions, audit logs. Optional analytics only if switched on.
   - Encrypted in transit: yes (HTTPS). Deletion request available: yes (after item 3). Not shared with third parties for advertising.
5. **Permissions**: location (foreground only), camera, microphone. Prepare the short in-app explanation text shown before each prompt; reviewers may test them.
6. **Policy risks**:
   - *Minimum functionality / WebView apps*: Play can reject apps that are only a website in a frame. Argue the app adds native permissions, camera/mic/GPS use, Back-button handling and install as an app; consider adding a native push-notification setup (the Push plugin is included but needs Firebase `google-services.json`) to strengthen it.
   - *Payments*: if the app lets people buy or change a subscription, Google Play Billing may be required for digital services. Safest is to keep subscription purchase and upgrade on the website only, and not link out to it from inside the app, until you have checked with Play support.
   - *Employee location*: foreground only, disclosed in-app; keep the consent text in the listing description too.
7. **App content**: content rating questionnaire, target audience (adults/business), no ads, news-app and government declarations as "No", test sign-in for reviewers (a demo workspace login in "App access"; never reuse a real customer's).
8. **Store listing assets** (brand kit in project files, teal `#0e7c6b` kept):
   - App icon 512x512: `brand/Agentify-ERP-brand-kit/app-icons/agentify-app-icon-512.png`.
   - Feature graphic 1024x500: not in the kit. Make it from `social/agentify-cover-1500x500.png` (crop/resize) and approve it.
   - Phone screenshots (2-8, 16:9 or 9:16): capture from the real app on a phone or emulator using the demo workspace; none exist yet.
   - Short description (80 chars) and full description: write without unproven claims (no fake reviews, user counts or partnerships).
9. **Release**: internal test track first, then closed test, then production with staged rollout. After the Play listing is live, set `VITE_ANDROID_STORE_URL` so the site shows the "Get it on Google Play" button.
