# Packaging

STARQUEST ships as six things from one codebase. The game itself is untouched by
any of it: the web version serves the repository as it stands, and the desktop
and mobile builds wrap exactly the same files.

| Platform | Output | Installable today? |
|---|---|---|
| Web | the repository, on GitHub Pages | Yes — <https://cyberhirsch.github.io/Starquest/> |
| Windows | `STARQUEST-<version>-windows-setup.exe` (NSIS) | Yes, past a SmartScreen warning |
| macOS | `STARQUEST-<version>-macos.dmg` (universal) | Yes, with a right-click → Open |
| Linux | `STARQUEST-<version>-linux.AppImage` | Yes |
| Android | `STARQUEST-android.apk` | Yes, by sideloading |
| iOS | — | **No.** See below. |

## Building

Everything is built by `.github/workflows/build-apps.yml`. Push a tag to cut a
release with the artifacts attached:

```
git tag v0.1.0 && git push origin v0.1.0
```

Or run **Actions → Build apps → Run workflow** any time for downloadable
artifacts without publishing anything.

Locally:

```
cd packaging/desktop && npm install && npm start      # run the desktop shell
cd packaging/desktop && npm run build                 # package for this OS

cd packaging/mobile && npm install && npm run add:android
cd packaging/mobile/android && ./gradlew assembleDebug
```

The game's runtime files are assembled into a payload directory by
`tools/make-dist.mjs`, which has no dependencies like the rest of `tools/`. The
packaging shells have their own `package.json` files so the root project stays
dependency-free and `npm test` keeps running with nothing installed.

## Why the desktop shell serves over `app://`

The obvious way to load a local game in Electron is `win.loadFile('index.html')`.
It does not work here, for two reasons that are both silent failures:

1. `index.html` loads `src/main.js` as an **ES module**, and Chromium refuses
   module scripts over `file://` — they have opaque origins, so the CORS check
   can never pass. The window comes up blank.
2. **WebGPU is only exposed in a secure context**, and `file://` is not one. Even
   with modules working, the primary renderer would quietly disappear and every
   desktop install would silently run on the WebGL2 fallback.

Registering a custom scheme as `standard` + `secure` fixes both, and gives
`localStorage` a stable origin so saves survive an app update.
`test/desktop.mjs` asserts all of it, because neither failure shows up as a
crash.

## What "unsigned" means on each platform

Nothing here is code-signed. That is a cost decision, not an oversight — signing
needs paid certificates, and none of them can be worked around in CI.

**Windows.** The installer runs. SmartScreen shows *"Windows protected your PC"*
on first launch; **More info → Run anyway** installs it. An Authenticode
certificate (~$200–400/year, more for EV) removes the warning.

**macOS.** The `.dmg` mounts and the app copies across, but Gatekeeper refuses a
plain double-click. **Right-click the app → Open → Open** works, once, after
which macOS remembers it. If macOS claims the app is *"damaged and can't be
opened"* — which is what Apple Silicon says about unsigned downloads rather than
anything being wrong with the file — clear the quarantine flag:

```
xattr -dr com.apple.quarantine /Applications/STARQUEST.app
```

A Developer ID certificate (part of the $99/year Apple Developer Program) plus
notarisation makes it double-clickable.

**Android.** The APK is debug-signed, which is enough to sideload: allow installs
from whatever app you downloaded it with, then tap the file. Google Play needs an
`.aab` signed with a release keystore and a Play developer account ($25 one-off).

**iOS.** There is no build. This is worth being precise about, because it is the
one platform where the limit is absolute rather than a warning to click past: an
iOS app can only be installed after being signed with a certificate issued by a
paid Apple Developer Program membership ($99/year). That applies to your own
phone as much as to the App Store, and there is no way around it from CI or
anywhere else. The workflow builds the project unsigned on every run, which
proves it compiles and stays compiling — but the result cannot be installed by
anyone.

If you join the programme, the iOS route is TestFlight: add the signing
certificate, provisioning profile and an App Store Connect API key as repository
secrets, then swap the `CODE_SIGNING_ALLOWED=NO` build for an `xcodebuild
-exportArchive` and an upload step. The Capacitor project the workflow already
generates is the same one you would use.

In the meantime iOS players have a real option: the web build is an installable
PWA. Open the site in Safari, **Share → Add to Home Screen**, and it runs
fullscreen with its own icon, offline, and saves progress — the same game
without the App Store.

## The Android project is generated, not committed

`packaging/mobile/android` and `ios` are in `.gitignore`. Capacitor rebuilds both
identically from `capacitor.config.json` on every build, and a committed copy is
thousands of files of Gradle and Xcode scaffolding that quietly goes stale — the
usual way to ship a configuration nobody meant to.

`tools/patch-android.mjs` applies the three things Capacitor's template gets
wrong for this game, which is a landscape title with a HUD anchored to the screen
edges:

- **Portrait orientation** → `sensorLandscape`. Every touch control is positioned
  against the long edge; in portrait the game is unplayable.
- **Visible status and navigation bars** → fullscreen, black, drawing into the
  display cutout. Those bars sit exactly where the throttle and button row are.
- **No wake lock** → `FLAG_KEEP_SCREEN_ON`. The web build asks for a wake lock,
  but that is only honoured over https with the page visible; the native flag is
  what actually holds the screen during a long flight.

Icons and splash screens for both mobile platforms are generated from
`packaging/mobile/assets/icon.png`, which is the same 1024px render of the
Corsair the PWA uses.

## Saves do not travel

Each install keeps its own `localStorage`. The browser, the desktop app and the
phone build are three separate save slots, and there is no sync between them.
