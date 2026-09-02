// Adjusts the Android project Capacitor generates. Run after `cap add android`
// / `cap sync android`, from the repository root.
//
// Capacitor's template is written for a portrait form app. This is a landscape
// game with an eight-minute session, so three defaults are wrong for it and one
// of them makes the game unplayable outright:
//
//   - portrait orientation: the HUD lays out for landscape and every touch
//     control is positioned against the long edge.
//   - a light theme with a visible status and navigation bar eating the top and
//     bottom of a screen the throttle and button row are anchored to.
//   - no wake lock, so the screen dims mid-flight whenever you stop tapping.
//
// It is a script rather than a committed android/ directory because the native
// project is thousands of files of Gradle scaffolding that Capacitor rebuilds
// identically from capacitor.config.json — and a stale committed copy is a
// quiet way to ship a configuration nobody meant to.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const ANDROID = join(ROOT, 'packaging/mobile/android');

if (!existsSync(ANDROID)) {
  console.error('no android project — run `npx cap add android` in packaging/mobile first');
  process.exit(1);
}

const edit = (rel, fn) => {
  const p = join(ANDROID, rel);
  if (!existsSync(p)) { console.log(`skip  ${rel} (not generated)`); return; }
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) { console.log(`same  ${rel}`); return; }
  writeFileSync(p, after);
  console.log(`patch ${rel}`);
};

// --- landscape, and no rotation mid-fight -----------------------------------
edit('app/src/main/AndroidManifest.xml', (s) => {
  let out = s;
  if (/android:screenOrientation=/.test(out)) {
    out = out.replace(/android:screenOrientation="[^"]*"/g, 'android:screenOrientation="sensorLandscape"');
  } else {
    out = out.replace(/(<activity\b[^>]*?)(\s*>)/, '$1\n            android:screenOrientation="sensorLandscape"$2');
  }
  // Handle the configuration changes ourselves rather than being restarted:
  // a recreate mid-flight drops the world and the unsaved run with it.
  out = out.replace(/android:configChanges="[^"]*"/,
    'android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"');
  return out;
});

// --- edge to edge, dark, and no system bars over the controls ---------------
// Both themes, not just AppTheme.NoActionBar: the manifest launches the
// activity with AppTheme.NoActionBarLaunch, and whether Capacitor swaps to the
// other one at runtime depends on which plugins are installed. Styling only the
// one the docs talk about leaves the status bar sitting over the topbar.
const FULLSCREEN = `
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
        <item name="android:statusBarColor">@android:color/black</item>
        <item name="android:navigationBarColor">@android:color/black</item>`;
edit('app/src/main/res/values/styles.xml', (s) => s
  .replace(/<item name="android:background">[^<]*<\/item>/g,
    '<item name="android:background">@android:color/black</item>')
  .replace(/(<style name="AppTheme\.NoActionBar(?:Launch)?"[^>]*>)/g, `$1${FULLSCREEN}`));

// --- keep the screen on while flying ----------------------------------------
// The web build asks for a wake lock, but Android only honours that over https
// with the page visible; the native flag is what actually holds the screen.
for (const rel of ['app/src/main/java/dev/cyberhirsch/starquest/MainActivity.java',
  'app/src/main/java/dev/cyberhirsch/starquest/MainActivity.kt']) {
  edit(rel, (s) => {
    if (/FLAG_KEEP_SCREEN_ON/.test(s)) return s;
    if (rel.endsWith('.java')) {
      return s
        .replace(/(^import .*?;\n)(?![\s\S]*^import )/m, '$1import android.view.WindowManager;\n')
        .replace(/(public class MainActivity extends BridgeActivity \{)/,
          `$1
    @Override
    public void onStart() {
        super.onStart();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
`);
    }
    return s
      .replace(/(^import .*?\n)(?![\s\S]*^import )/m, '$1import android.view.WindowManager\n')
      .replace(/(class MainActivity : BridgeActivity\(\) \{)/,
        `$1
    override fun onStart() {
        super.onStart()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
`);
  });
}

console.log('android project patched for a landscape, fullscreen game');
