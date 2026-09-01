# STARQUEST

A first-person retro laser vector-graphics space game. Every object in the belt — hulls,
rocks, the depot, the cockpit you sit in — is a low-poly 3D mesh drawn as glowing
line segments, bloomed and pushed through a CRT grade. It renders with **WebGPU**,
falls back to **WebGL2**, and installs to an Android or iOS home screen as a PWA.

You either fly the ship or you work a gun. That is the whole tension: bigger hulls
carry more weapon mounts than one pilot has hands, so every mount past the seat you
occupy needs an **auto-turret** — or it flies empty.

```
npm start          # serves on http://localhost:8080
```

Then open <http://localhost:8080>. No build step, no dependencies — it is ES modules
and a 60-line static server. Add `?gfx=webgl` or `?gfx=webgpu` to force a backend.

## Install on a phone

Serve the folder over HTTPS (GitHub Pages, Netlify, any static host) and open it on
the device.

- **Android / Chrome** — tap **INSTALL** on the flight deck, or *⋮ → Install app*.
  It launches fullscreen, landscape-locked, and runs offline.
- **iOS / Safari** — *Share → Add to Home Screen*. Launches fullscreen from the icon.
  WebGPU needs iOS 26+; older iPhones fall back to WebGL2 automatically.

The service worker caches the whole game on first load, so it plays with no signal.

## Controls

**Touch** — the left bar is the throttle: above centre is forward, below is reverse,
double-tap to cut to zero. **FIRE** sits under it. Touch anywhere on the right half to
place the steering stick. `MODE` swaps between the pilot and gunner seats, `TGT`
cycles contacts, `ACT` docks or boards, `INV` opens the loadout.

**Keyboard / mouse** — `W`/`S` throttle (`X` to zero, wheel trims) · mouse steers
(click to capture the pointer; `A`/`D` and the arrows also work) · `Q`/`E` roll ·
`Space` or click to fire · `R` pilot/gunner · `T` target · `F` dock or board ·
`Tab` inventory · `1`–`6` pick which mount you are manning · `G` flight assist ·
`M` manual.

## The belt

- **Mine.** Fit a mining laser and cut rocks apart. Ore trickles straight into the
  hold while you cut; a rock that breaks scatters cargo pods and smaller rocks. Ore
  type is visible in the colour of the wireframe.
- **Fight.** Pirates hunt the belt. Shoot a licensed hull and the Authority prices
  your head; kill a pirate and you are paid a bounty.
- **Board.** Ion weapons and heavy damage leave hulls adrift instead of scattering
  them. Carry a breaching rig, match velocity, and cut your way in — three clean
  charges strips the hold and files a claim on the hull worth half price at the yard.
- **Trade.** Halcyon Depot buys ore, sells hulls, modules and services. Prices drift
  every time you dock.
- **Grow.** A Vex Shuttle has one mount. A Bastion has six. Auto-turrets acquire,
  lead and fire on their own while you fly — the only way a big hull earns its price.

Progress saves to `localStorage` on docking and on exit.

## Layout

```
index.html            shell: canvas, HUD, touch controls
manifest.webmanifest  PWA manifest (fullscreen, landscape)
sw.js                 generated offline cache — rebuild with `npm run sw`
src/
  main.js             bootstrap, frame loop, camera, action handling
  core/math.js        vec3 / quaternion / mat4, projection, lead prediction
  render/
    renderer.js       WebGPU: instanced line pass, bloom chain, CRT composite
    renderer_gl.js    WebGL2 fallback with the same pipeline
    shaders.js        WGSL          shaders_gl.js  GLSL twins
    backend.js        picks WebGPU, falls back to WebGL2
    lines.js          the line batch every system draws into
    models.js         low-poly hulls, station, asteroids, all as edge lists
    scene.js          world -> line segments
    palette.js        phosphor colours
  game/
    data.js           hulls, modules, ores, trade goods
    ship.js           stats, flight model, gunnery, auto-turrets, damage
    world.js          entities, spawning, collisions, effects, spawn director
    ai.js             pirate / security / trader / miner brains
    player.js         hangar, credits, storage, persistence
    station.js        market, shipyard, outfitting, services
    boarding.js       breach mini-game and loot
  ui/
    screens.js        DOM overlays        hud.js    vector HUD, radar, reticles
    input.js          keyboard/mouse/touch      mobile.js  PWA, wake lock, scaling
    audio.js          WebAudio synth (no samples)  style.css
tools/                icon and service-worker generators
test/integration.mjs  headless play-through of every system
```

## How the vector look works

There are no triangles in the scene — only edges. Each edge becomes one instanced
quad that the vertex shader expands in **screen space**, so a line is the same
weight whether it is 10 metres away or 4 kilometres. The fragment shader shades it
as a distance field: a tight exponential core, a wide halo, and a white-hot centre.
Everything is drawn additively into an HDR target with no depth buffer, which is
exactly how a real vector monitor behaves — nothing occludes anything. Bloom runs
at half and quarter resolution, then the composite does the tone map, barrel
distortion, aperture grille, radial chromatic aberration and vignette.

The HUD, radar and cockpit frame go through the same pipeline as screen-space
segments, so they glow identically.

## Development

```
npm start            # static server
npm test             # headless integration suite (25 assertions, no browser needed)
npm run icons        # regenerate PWA icons from the Corsair mesh
npm run sw           # regenerate the service worker file list + version
```

`npm run test:browser` additionally drives the touch controls in a real Chromium —
it needs Playwright installed and the server already running:

```
node server.js &
PLAYWRIGHT=$(npm root -g)/playwright/index.mjs GFX=webgl npm run test:browser
```

Run `npm run sw` after changing any source file, or the offline cache will serve a
stale build.
