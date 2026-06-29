# Mobile App (Android & iOS) — Capacitor

This wraps the existing React client (`client/dist`) in a **real native app** using
[Capacitor](https://capacitorjs.com). It reuses all the web UI — no rewrite.

## ⚠️ Read first: the backend constraint

A phone **cannot run the local Node server**, so the app must reach a backend over
the network. Two options:

- **A) LAN — full features (incl. Thai stocks).** Run the desktop app (or `npm start`)
  on your PC; the phone (same Wi-Fi) connects to your PC's IP. Yahoo works from your
  PC's residential IP, so Thai SET / dividends / news all work. Best for personal use.
- **B) Render — works anywhere.** Deploy [`render.yaml`](render.yaml) and set
  `TWELVEDATA_KEY` + `FINNHUB_KEY` in Render. Yahoo is blocked on cloud IPs, so **Thai
  SET needs the paid Twelve Data plan**; US/ETF/crypto/gold/FX/news still work.

## Prerequisites (one-time)

- **[Android Studio](https://developer.android.com/studio)** (free) — bundles the JDK +
  Android SDK needed to build the APK. *(Capacitor 8 needs JDK 21, included with current
  Android Studio.)* This machine currently has no JDK/SDK, so this install is required.
- Node.js (already installed).

## Build the Android app

1. **Pick your backend URL**
   - LAN: run `ipconfig`, note your IPv4 (e.g. `192.168.1.50`) → `http://192.168.1.50:8787`
   - Render: `https://your-app.onrender.com`
2. **Build the web client with that backend baked in** (PowerShell):
   ```powershell
   $env:CAP_BUILD="1"
   $env:VITE_API_BASE="http://192.168.1.50:8787"   # or your Render https URL
   $env:VITE_WS_URL="ws://192.168.1.50:8787/ws"     # use wss:// for Render
   npm run build
   npx cap sync android
   ```
3. **Open in Android Studio & run**
   ```powershell
   npx cap open android
   ```
   Wait for Gradle sync, plug in a phone (USB debugging on) or start an emulator, click **Run ▶**.
   - CLI alternative: `cd android; .\gradlew.bat assembleDebug` → APK at
     `android/app/build/outputs/apk/debug/app-debug.apk` (copy to your phone & install).

## Notes / troubleshooting

- LAN uses plain `http`; `capacitor.config.json` sets `cleartext: true`. If a LAN build
  shows a blank screen (mixed-content block), change `androidScheme` to `"http"` in
  `capacitor.config.json` and re-run `npx cap sync android`.
- For the LAN option the **PC server must be running** and the phone on the **same Wi-Fi**.
- After changing any web code: `npm run build` (with the env vars above) → `npx cap sync android`.

## iOS

Requires a **Mac** with Xcode + an Apple Developer account ($99/yr) — **iOS cannot be
built on Windows**. On a Mac:
```bash
npm install @capacitor/ios && npx cap add ios && npx cap open ios
```
then build/sign in Xcode. Without a Mac, a cloud-Mac CI (Codemagic, Ionic Appflow) is the
only option.
