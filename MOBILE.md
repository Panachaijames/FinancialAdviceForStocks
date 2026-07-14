# Mobile App (Android & iOS) — Capacitor

This wraps the existing React client (`client/dist`) in a **real native app** using
[Capacitor](https://capacitorjs.com). It reuses all the web UI — no rewrite.

## How it reaches the backend

The app loads the **hosted web app directly**: [`capacitor.config.json`](capacitor.config.json)
sets `server.url` to the Render deployment, so the WebView shows the cloud app and all
`/api` + `/ws` calls go there. **`server.url` overrides any `VITE_API_BASE` baked into the
build** — so for the cloud build you do *not* set those env vars; the live app also updates
on its own whenever the server redeploys.

Data coverage matches the web/desktop app: US stocks/ETFs, crypto, gold, FX, and news work
everywhere; **Thai SET stocks need the paid Twelve Data plan** because Yahoo blocks cloud
datacenter IPs (set `TWELVEDATA_KEY` + `FINNHUB_KEY` in Render).

> **Prefer a LAN / local backend** (free Thai SET via your PC's residential IP)? Point
> `server.url` in `capacitor.config.json` at your PC — e.g. `http://192.168.1.50:8787`
> (keep `"cleartext": true` for plain http) — start the server on your PC (`npm start`),
> keep the phone on the same Wi-Fi, then re-run `npx cap sync android`.

## Prerequisites (one-time)

- **[Android Studio](https://developer.android.com/studio)** (free) — bundles the JDK +
  Android SDK needed to build the APK. *(Capacitor 8 needs JDK 21, included with current
  Android Studio.)*
- Node.js (already installed).

## Build the Android app

1. **Build the web client and sync it into the native project** (PowerShell):
   ```powershell
   $env:CAP_BUILD="1"
   npm run build
   npx cap sync android
   ```
   No `VITE_API_BASE` / `VITE_WS_URL` needed — `server.url` in `capacitor.config.json`
   decides the backend. The bundled `client/dist` is only a fallback used if `server.url`
   is removed.
2. **Open in Android Studio & run**
   ```powershell
   npx cap open android
   ```
   Wait for Gradle sync, plug in a phone (USB debugging on) or start an emulator, click **Run ▶**.
   - CLI alternative: `cd android; .\gradlew.bat assembleDebug` → APK at
     `android/app/build/outputs/apk/debug/app-debug.apk` (copy to your phone & install).

## Notes / troubleshooting

- The cloud `server.url` uses `https`. For a **LAN** backend over plain `http`,
  `capacitor.config.json` already sets `cleartext: true`; if a LAN build shows a blank
  screen (mixed-content block), also change `androidScheme` to `"http"` and re-run
  `npx cap sync android`.
- A LAN backend needs the **PC server running** (`npm start`) and the phone on the **same Wi-Fi**.
- After changing web code you want in the **fallback** bundle: `npm run build` → `npx cap sync android`.

## iOS

Requires a **Mac** with Xcode + an Apple Developer account ($99/yr) — **iOS cannot be
built on Windows**. On a Mac:
```bash
npm install @capacitor/ios && npx cap add ios && npx cap open ios
```
then build/sign in Xcode. Without a Mac, a cloud-Mac CI (Codemagic, Ionic Appflow) is the
only option.
