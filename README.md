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
and a 34-line static server. Add `?gfx=webgl` or `?gfx=webgpu` to force a backend.

## Get it

| | |
|---|---|
| **Web** | <https://cyberhirsch.github.io/Starquest/> — plays in the browser, installs as a PWA |
| **Windows** | `.exe` installer from [Releases](../../releases) |
| **macOS** | `.dmg` from Releases — right-click → Open the first time, it is unsigned |
| **Linux** | `.AppImage` from Releases |
| **Android** | `.apk` from Releases, sideloaded — or add the web version to your home screen |
| **iOS** | Add the web version to your home screen |

Every build is the same game from the same files; the desktop and phone builds are
shells around the web version rather than ports of it. There is no iOS binary,
because Apple only allows an app onto a phone once it is signed with a certificate
from a paid developer account — the PWA is the way in on iOS, and it is a good one:
fullscreen, offline, its own icon. [docs/PACKAGING.md](docs/PACKAGING.md) covers how
each build is made and exactly what "unsigned" costs you on each platform.

Saves are per install. The browser, the desktop app and the phone build do not share
progress.

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

**Touch** — the left bar sets the speed you want to fly, not how hard you push: put
it half way and the drives trim themselves to hold half the hull's rating, rather
than winding you up to maximum a bit more slowly. Above centre is forward, below is
astern, double-tap to stop. Switch flight assist off and it is a plain thrust lever
again. **FIRE** sits under it with **TGT** beside it, both under the same thumb —
TGT is a combat control, so it goes with the trigger rather than across the canopy
with the menus. Touch anywhere on the right half to place the steering stick.
`MODE` swaps between the pilot and gunner seats, `HAIL` opens a channel to your
target, `ACT` docks or boards, `INV` opens the loadout, `MENU` pauses and opens the
flight manual.

`TGT` goes to the nearest thing shooting at you and steps out through the rest;
with nothing hostile on the scope it locks whatever is in the middle of the canopy
instead, then cycles the traffic, the depot, the gate and the claims. The mining
laser never needed a lock, so pointing and cutting still works in a fight.

**Keyboard / mouse** — `W`/`S` raise and lower the speed you are holding (`X` stops,
wheel trims) · mouse steers
(click to capture the pointer; `A`/`D` and the arrows also work) · `Q`/`E` roll ·
`Space` or click to fire · `R` pilot/gunner · `T` target · `F` dock or board ·
`H` hail · `Tab` inventory · `1`–`6` pick which mount you are manning ·
`G` flight assist · `M` manual · `K` skip the tutorial · `I` install to the home screen.

Every button you can see while flying has a key, and wears it: the HUD row carries
its letter above the label, and a hail is a numbered menu — `1`–`6` answer the
channel while it is open (they go back to picking mounts when it closes) and `Esc`
hangs up. On a touch device the key badges are hidden, because there is no keyboard
to press.

## Getting started

A short tutorial walks the first flight — throttle, steering, locking a rock, cutting
ore, scooping pods, docking, selling, and fitting your first auto-turret. It shows one
objective at a time and can be skipped from the card or the manual.

The game saves itself every 30 seconds, when you dock, when a tutorial step completes,
and whenever the page is hidden or closed — so swiping the app away does not cost you
progress. `SAVE NOW` and `RELOAD LAST SAVE` live in the manual (`M`, or the flight
manual button).

## A region has a character

Each sector has its own sky, built from a seed in its definition, so a belt looks
the same every time you come back to it and does not look like the one next door.
Halcyon is a dense cold starfield under a white sun with a blue world a long way
off. Cinder is dimmer and warmer, lit by a small red sun from the wrong side of
the system, with a gas giant close enough overhead to be a presence. The Depot is
a maintained ring; Tallow Yard is a dead freighter with a dock cut into its flank,
because that is what the fiction says it is.

Difficulty belongs to the place, not to you. Halcyon is the same belt on your
first flight as it is fifty kills and a Bastion later: two pirates at a time,
pulse cannons, arriving from the sector edge where you can see them coming, and
you take 60% damage. It is not a fixed spawn table either — roughly one hull in
four turns up a notch above the local standard, and about a third of the pilots
can actually fly, so a quiet belt still has bad days.

Cinder Reach is not a later stage of that, it is a rougher place: five at a
time, turrets and thrusters as standard, three quarters of them evasive, full
damage, and nobody coming when you call. You get there by flying through a gate,
not by levelling up.

The point is that the belt you learned to survive stays survivable. Getting
better and buying a bigger hull is supposed to make you stronger where you are —
if the sector answers by getting stronger too, the upgrade bought you nothing.

Nothing stops you leaving. The belt is about five kilometres across, and past the
buoys there is no wall and no warning — you can point the nose at the dark and
fly until you get bored. It is honest about what is out there: no traffic, no
ambushes, nothing to find. Just the sector's own stars, and the belt getting
small behind you.

## Two sectors

**Halcyon Belt** is licensed, patrolled and rich in rock. **Cinder Reach** through the
jump gate is a graveyard — thick with adrift hulls to board, twice the pirates, and no
Authority at all. Fly into a gate ring and use ACT to jump; your wingmen come with you.

The two stations want different things. Tallow Yard has no belt of its own so it pays
around 40% over the odds for ore and dumps salvaged goods cheap, while Halcyon Depot is
the reverse. That is a trade route: mine here, sell there, fill the hold with cheap
goods, sell them back home.

## Named claims

Each sector reaches further than its belt does — 9 km in Halcyon, 11 in Cinder — and out
past the working rock there are two named claims in each, marked by a beacon and a ring
you can see as you come up on them. The main belt is unchanged; the claims are somewhere
to be *sent*.

- **THE COLD SHOAL** — ice and silicon, worked out of a licensed Halcyon claim.
- **TANNER'S ANVIL** — platinum and gold, far enough out that the patrols are a rumour.
- **THE SPILL** — a freighter's xenite cargo across four hundred metres of rock.
- **HOLLOW MARCH** — a line of hulls in Cinder that all stopped in the same place.

A claim is made of the rock it is named for: about three rocks in five at the Anvil are
platinum, against roughly one in sixteen anywhere else. That matters because the board
now writes jobs with an address on them, and a job that sends you somewhere had better be
sending you somewhere worth the flight.

TGT steps through places as well as contacts — the depot, the gate and both claims are on
the cycle, with the name and range on the target panel and a bearing arrow when it is off
screen.

## Contracts

Halcyon Depot and Tallow Yard both keep a board. Bounties on pirate hulls, supply runs
settled out of your hold the moment you dock, sealed courier freight for the other
station, and salvage jobs paid on boarding adrift hulls. Three at a time; the tracked
one shows on the HUD. Dropping one costs you standing.

Some jobs name a place, and those only count there. **PROSPECT** wants so many units of
one ore cut out of one claim — rock from the main belt does not count, and neither does
carrying the job through the gate. **SWEEP** wants pirate hulls put down inside the claim
itself. **RECOVERY** wants hulls boarded at Hollow March. The open jobs are still there,
so the board is a mix of work you can do anywhere and work with an address.

The job on the HUD is the one you tracked (TRACK on the CONTRACTS tab), and its
counter moves as your hold fills.

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
  scales with what you are worth to them; pay it and they leave you alone for about a
  minute, hunting someone else instead. Your own turrets hold their fire for the
  duration, but shoot them yourself and the deal is off. Threatening them works only
  if you are visibly the bigger ship.
- **Take without shooting.** Hail a weaker trader and demand their cargo — they read
  the odds and jettison pods rather than die. It is piracy, it is logged, and the
  Authority prices your head accordingly.
- **Mercy pays.** A hull you left adrift will buy its crew's lives, and the ransom
  often beats what boarding would have got you.
- **Get scanned.** Hail an Authority patrol and submit to a scan: contraband is
  seized and fined, a clean hold costs nothing but the time. They only look once.
- **Maydays.** Traders run from whoever shoots them, whether that is you or a
  pirate two kilometres away, and a trader under attack broadcasts for help
  naming a reward. Drive the attacker off yourself and it is paid; arrive after
  someone else has, and you get the thanks and nothing else. Rob someone and they
  will not be calling you.
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
  keep their full rating, which is part of what you are buying when you upgrade.
  Land a few rounds and they stop flying predictably: anything above the lowest
  tier jinks while it is under fire, which halves your hit rate past 700 m and
  turns a runner from a free kill into work. Close the range and it stops
  helping them — nothing dodges a 900 m/s bolt at 300 m — so a knife fight is
  still a knife fight, and still where you take the most damage.
  A hull shot below a third loses drive power with it, so a fight you are winning
  ends in a catch instead of a stern chase. One that breaks off badly hurt commits
  to leaving rather than circling back, and if it reaches the buoys still running
  it is gone for good — chase it down or let it go. Every hull you put down buys about half a
  minute before the next one arrives, so a fight you are winning gets easier rather
  than being topped straight back up to quota; deal with the last enemy in the sector
  — shot to pieces or ioned and left adrift, a hulk is cargo either way — and it
  stays clear for two to three minutes: long enough to mine, scoop and sell without
  looking over your shoulder. Shoot a licensed hull and the
  Authority prices your head; kill a pirate and you are paid a bounty.
- **Read the fight.** Anything that can hurt you is drawn red — your own fire
  keeps its colour and neutral traffic is dim. The name of whoever is shooting
  you sits under the topbar, their bearing on a ring around the reticle, and hull
  and shield are on screen as numbers. Shields giving out strobes the panel. When
  you do die, the screen names the ship that killed you and shows what share of
  the damage came from where. The belt stays quiet for the first minute of a new
  game, and the licensed belt is a gentler place to be shot at than the reach.
- **Board.** Ion weapons and heavy damage leave hulls adrift instead of scattering
  them. Carry a breaching rig, match velocity, and cut your way in — three clean
  charges strips the hold and files a claim on the hull worth half price at the yard.
- **Trade.** Halcyon Depot buys ore, sells hulls, modules and services. Prices drift
  every time you dock. It is a solid object, not scenery — rounds stop on it, hulls
  bounce off it, and putting fire into the place that sells you fuel costs you
  bounty and a warning over the radio. Keep at it and they shut the bay for a
  minute and a half, and jumping out and back does not clear it. Your turrets are
  not your fault; your own trigger is.
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
    scene.js          world -> line segments, and each sector's own sky
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
tools/                icon, service-worker and payload generators
packaging/desktop/    Electron shell -> Windows installer, macOS dmg, AppImage
packaging/mobile/     Capacitor shell -> Android APK, iOS project
test/integration.mjs  headless play-through of every system
test/render.mjs       draws real frames, fails on non-finite geometry
test/browser.mjs      optional Playwright pass over the real touch controls
test/desktop.mjs      optional Electron pass over the app:// shell
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

## Key art

`node tools/make-art.mjs` renders the pictures on this page, and it renders them
with the game: the same models, the same palette, the same additive vector pass.
Two things turn a screenshot into a photograph — the player's own hull is never
drawn because the camera lives inside it, so posing an empty `player.ship` gives
you a free camera; and `drawHUD` is skipped while docked, so that flag clears the
canopy. A scene is data, and composes in the angle a thing subtends rather than
in metres, because a hull is 5–11 m and a station is 83 and framing by eye puts
one of them in your lap.

Needs Playwright, like the browser suite. `W`, `H` and `SCALE` set the size — the
default is 1920×1080 at 2×, so 4K. The output is not committed: 4K frames of a
grain shader do not compress, and the repo can redraw them.

## Development

```
npm start            # static server
npm test             # headless: 104 integration assertions + 14 render scenarios
npm run icons        # regenerate PWA icons from the Corsair mesh
npm run sw           # regenerate the service worker file list + version
npm run dist         # assemble the game's runtime files into dist/
```

Two optional suites need something installed. `npm run test:browser` drives the touch
controls in a real Chromium, with the server already running:

```
node server.js &
PLAYWRIGHT=$(npm root -g)/playwright/index.mjs GFX=webgl npm run test:browser
```

`npm run test:desktop` checks the Electron shell — that the game is served over a
secure custom scheme and that its ES modules actually load, both of which fail
silently rather than crashing if the shell is misconfigured:

```
cd packaging/desktop && npm install && cd ../..
npm run dist -- packaging/desktop/app
xvfb-run -a npm run test:desktop      # drop xvfb-run off Linux
```

Run `npm run sw` after changing any source file, or the offline cache will serve a
stale build.
