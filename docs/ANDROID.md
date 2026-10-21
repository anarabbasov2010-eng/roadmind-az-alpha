# Android build (Alpha)

RoadMind AZ uses the same React/TypeScript/MapLibre application on Android via Capacitor. The Android APK is built automatically by GitHub Actions after pushes to `main`, or manually from Actions → Build Android APK → Run workflow.

## Get the APK
Open the repository's Actions tab, select the latest successful **Build Android APK** run, then download the `RoadMind-AZ-Android-Alpha` artifact and extract `app-debug.apk`. Android may ask you to allow installs from the browser or file manager you used.

## Updating
The workflow caches a stable alpha debug-signing key so subsequent APK builds can normally be installed over the previous alpha without clearing app data. Keep the cache and application ID (`az.roadmind.app`) unchanged. This is an alpha distribution method, not a Play Store signing setup; for long-term reliable updates, migrate to a private release keystore stored in GitHub Actions secrets before wider distribution.

The app shares the desktop web code and its existing map, road graph, traffic simulation, signal/scenario tools and data provenance notices. Network basemap and OSM imports still require internet access. This workflow creates an APK artifact; it does not publish to Google Play.
