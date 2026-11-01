# Google Play launch: what YOU do by hand (step by step)

Nothing here can be done by Claude: it needs your identity, payment and verification. Technical background is in `PLAY_STORE.md`; listing text is in `PLAY_STORE_LISTING.md`.

## A. Create the developer account
1. Decide the account type.
   - **Personal**: free of paperwork, but a *new personal account must run a closed test with at least 12 testers opted in for 14 continuous days before production access.* Plan for about 3 weeks.
   - **Organisation**: needs a D-U-N-S number and a business website/phone; no 12-tester rule. Choose this if the company is registered.
   - Confirm the current rules in Play Console, they change.
2. Go to https://play.google.com/console/signup and sign in with a Google account you will keep long term (not a throwaway; use a dedicated company address).
3. Pay the one-time **US$25** registration fee by card.
4. Verify identity: government ID, a payment profile, a phone number and email (both get a code). Organisation accounts also verify the D-U-N-S details. Approval can take from hours to a few days.
5. Turn on 2-step verification for the Google account and save its recovery codes.

## B. Make your upload key (once, on your own PC, never in chat or git)
Needs JDK 21 (`keytool` ships with it).
```
keytool -genkeypair -v -keystore agentify-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```
- Choose strong passwords. Back the `.jks` file and passwords up in two places (password manager + encrypted drive).
- Where to keep secrets: `mobile/android/keystore.properties` (already git-ignored) containing
  `storeFile=C:/path/to/agentify-upload.jks`, `storePassword=...`, `keyAlias=upload`, `keyPassword=...`.
  Or set `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` environment variables.
- Never commit the file or send passwords to anyone. Because you use **Play App Signing**, if the upload key is lost Google can reset it, which is why it is only an upload key.

## C. Build the AAB
```
cd mobile && npm install && npx cap sync android
cd android && ./gradlew bundleRelease     # on Windows: gradlew.bat bundleRelease
```
Output: `mobile/android/app/build/outputs/bundle/release/app-release.aab`. Current version is `versionCode 3 / 1.2.0`; raise `versionCode` in `android/app/build.gradle` for every later upload. This build has never been run on a phone yet: install `assembleDebug` on a real Android phone and test location, camera, mic, uploads and Back first.

## D. Create the app in Play Console
1. All apps > Create app: name **Agentify ERP**, default language English, type App, Free, accept declarations.
2. Package name is `co.agentifyerp.app` (fixed by the first upload).
3. Dashboard "Set up your app" tasks, in order:
   - **Privacy policy**: https://agentifyerp.co/legal/privacy. The page has a draft that still contains `[bracketed]` company details. Fill them in and publish via Super Admin > Website builder > Legal, ideally after a lawyer review. Play rejects placeholders.
   - **App access**: provide a demo workspace login for reviewers (never a real customer's).
   - **Ads**: No.
   - **Content rating**: see `PLAY_STORE_LISTING.md`.
   - **Target audience**: 18+ (business users).
   - **Data safety**: use the answers in `PLAY_STORE_LISTING.md`; account deletion URL https://agentifyerp.co/delete-account.
   - **Government / news / health / financial-features** declarations: No (it is business software; it does not provide loans or banking).
   - **Store listing**: paste text, upload icon, feature graphic, screenshots.
4. Testing > Internal testing: upload the AAB, add yourself, install from the opt-in link.
5. Personal account only: Testing > Closed testing, add 12+ testers (Google group or email list), run 14 days, then apply for production access.
6. Production > create release with staged rollout (start 20%), submit for review (usually a few days, first review can be longer).

## E. After approval
- Set the Google Play link in Super Admin > Website builder > Mobile app, and `VITE_ANDROID_STORE_URL` so the site shows "Get it on Google Play".
- Keep the debug APK download only until the store listing is live.

## What stays with you
Account sign-up, the $25 fee, ID/D-U-N-S verification, the upload keystore and passwords, the lawyer-reviewed privacy policy, real phone screenshots, the 12-tester closed test, and pressing Submit.
