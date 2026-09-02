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

The repository ships a GitHub Pages workflow (`.github/workflows/pages.yml`) that
publishes `main` on every push, after the test suite passes. Pages has to be turned
on once by hand — **Settings → Pages → Build and deployment → Source: GitHub
Actions** — because a workflow token is not allowed to enable it. After that, re-run
the workflow and the game is live at `https://<user>.github.io/<repo>/`.

Any HTTPS static host works just as well; every path in the project is relative, so
a repository subpath needs no configuration.

Open the URL on the device.

- **Android / Chrome** — tap **INSTALL** on the flight deck, or *⋮ → Install app*.
  It launches fullscreen, landscape-locked, and runs offline.
- **iOS / Safari** — *Share → Add to Home Screen*. Launches fullscreen from the icon.
  WebGPU needs iOS 26+; older iPhones fall back to WebGL2 automatically.

The service worker fetches from the network first and falls back to its cache, so a
new build reaches you on the next launch and the game still plays with no signal at
all. Backgrounding a phone app usually takes the GPU context with it; both renderers
rebuild themselves when that happens, and reload as a last resort rather than leaving
you on a blank canvas.

## Controls

**Touch** — the left bar is the throttle: above centre is forward, below is reverse,
double-tap to cut to zero. **FIRE** sits under it. Touch anywhere on the right half to
place the steering stick. `MODE` swaps between the pilot and gunner seats, `TGT`
cycles contacts, `HAIL` opens a channel to your target, `ACT` docks or boards,
`INV` opens the loadout.

**Keyboard / mouse** — `W`/`S` throttle (`X` to zero, wheel trims) · mouse steers
(click to capture the pointer; `A`/`D` and the arrows also work) · `Q`/`E` roll ·
`Space` or click to fire · `R` pilot/gunner · `T` target · `F` dock or board ·
`H` hail · `Tab` inventory · `1`–`6` pick which mount you are manning ·
`G` flight assist · `M` manual.

## Getting started

A short tutorial walks the first flight — throttle, steering, locking a rock, cutting
ore, scooping pods, docking, selling, and fitting your first auto-turret. It shows one
objective at a time and can be skipped from the card or the manual.

The game saves itself every 30 seconds, when you dock, when a tutorial step completes,
and whenever the page is hidden or closed — so swiping the app away does not cost you
progress. `SAVE NOW` and `RELOAD LAST SAVE` live in the manual (`M`, or the flight
manual button).

## Two sectors

**Halcyon Belt** is licensed, patrolled and rich in rock. **Cinder Reach** through the
jump gate is a graveyard — thick with adrift hulls to board, twice the pirates, and no
Authority at all. Fly into a gate ring and use ACT to jump; your wingmen come with you.

The two stations want different things. Tallow Yard has no belt of its own so it pays
around 40% over the odds for ore and dumps salvaged goods cheap, while Halcyon Depot is
the reverse. That is a trade route: mine here, sell there, fill the hold with cheap
goods, sell them back home.

## Contracts

Halcyon Depot and Tallow Yard both keep a board. Bounties on pirate hulls, supply runs
settled out of your hold the moment you dock, sealed courier freight for the other
station, and salvage jobs paid on boarding adrift hulls. Three at a time; the tracked
one shows on the HUD. Dropping one costs you standing.

## Salvage

Boarding empties a hull's hold. A **salvage cutter** takes the hull itself apart:
scrap into your cargo, and whatever was bolted to it recovered whole into storage —
cheap fittings usually survive the cut, expensive ones rarely do. The hulk breaks up
when there is nothing left. Cinder Reach restocks its dead, and Tallow Yard pays well
over the odds for scrap and drive cores. Clearing the whole graveyard is worth roughly
what a Corsair costs, if you live through it.

## Crew

Hire a pilot at either station and they fly their own hull on your wing, break to
engage what threatens you, and follow you through jumps. Two on the books at most, and
no insurance if they are shot down.

## Talking

Lock a contact inside 2.6 km and `HAIL` opens a channel — the radio is a way through
fights you would rather not have, and a way to start ones that pay.

- **Buy your way out.** A pirate closing on you will usually take a tribute. The price
  scales with what you are worth to them; pay it and they break off. Threatening them
  works only if you are visibly the bigger ship.
- **Take without shooting.** Hail a weaker trader and demand their cargo — they read
  the odds and jettison pods rather than die. It is piracy, it is logged, and the
  Authority prices your head accordingly.
- **Mercy pays.** A hull you left adrift will buy its crew's lives, and the ransom
  often beats what boarding would have got you.
- **Get scanned.** Authority patrols hail *you*. Contraband in the hold is seized and
  fined; a clean hold costs you nothing but the time.
- **Maydays.** A trader under attack broadcasts for help and names a reward — drive
  the attacker off and it is paid. Rob someone yourself and they will not be calling
  you.
- **Wing orders.** Hail your own hires to send them at your target, form back up, or
  hold position.

Stations and pilots also gossip: hails pick up rumours about prices and pirate
activity, and the belt chatters over the open channel while you fly.

## The belt

- **Mine.** Fit a mining laser and cut rocks apart. Ore trickles straight into the
  hold while you cut; a rock that breaks scatters cargo pods and smaller rocks. Ore
  type is visible in the colour of the wireframe.
- **Fight.** Pirates hunt the belt. Computer-flown hulls are capped at 150 m/s
  whatever they have fitted, so a runner can always be run down — your own ships
  keep their full rating, which is part of what you are buying when you upgrade. Shoot a licensed hull and the Authority prices
  your head; kill a pirate and you are paid a bounty. The HUD names whoever is
  shooting you and marks their bearing on a ring around the reticle, and hull and
  shield are always on screen as numbers — nothing kills you silently. New pilots
  take reduced damage until they have some standing, and the belt stays quiet for
  the first minute.
- **Board.** Ion weapons and heavy damage leave hulls adrift instead of scattering
  them. Carry a breaching rig, match velocity, and cut your way in — three clean
  charges strips the hold and files a claim on the hull worth half price at the yard.
- **Trade.** Halcyon Depot buys ore, sells hulls, modules and services. Prices drift
  every time you dock.
- **Grow.** A Vex Shuttle has one mount. A Bastion has six. Auto-turrets acquire,
  lead and fire on their own while you fly — the only way a big hull earns its price.

Progress lives in `localStorage`.

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
  game/
    sectors.js        sector and station definitions
    contracts.js      the station boards and what settles them
    crew.js           hired wingmen
    comms.js          hails, tribute, ransom, scans, maydays, wing orders
    tutorial.js       the first-flight objectives
  ui/
    screens.js        DOM overlays        hud.js    vector HUD, radar, reticles
    input.js          keyboard/mouse/touch      mobile.js  PWA, wake lock, scaling
    audio.js          WebAudio synth (no samples)  style.css
tools/                icon and service-worker generators
test/integration.mjs  headless play-through of every system
test/render.mjs       draws real frames, fails on non-finite geometry
test/browser.mjs      optional Playwright pass over the real touch controls
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
