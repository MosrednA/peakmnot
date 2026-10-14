# Performance

What the climb costs to draw, how to measure it on any computer, what the first pass found, and what's left to try.
The office-chair downhill came later, on the same look; [The downhill](#the-downhill) says what it took over and what
its own pass found.

## Measuring

### In a browser

Every game has it. Open [`peak.html?perf`](https://peakmnot.mosredna.eu/peak.html?perf) for the climb or
[`downhill.html?perf`](https://peakmnot.mosredna.eu/downhill.html?perf) for the downhill (on the dev server,
`http://127.0.0.1:5280/peak.html?perf` and so on). The climb takes about a minute and the downhill about two: keep the
tab in front and leave it be. Add `&by=NAME` to the link to say whose computer it was.

At the end the run goes to the score server, `POST /api/<game>/perf` ([server/README.md](../server/README.md)). The
run holds what the browser says about the computer: graphics chip, screen size, pixel ratio and browser. The server
keeps no IP address. Once the run is in, a card says thank you, with a nerdy joke and another on request
([`peak/kit/thanks.js`](../peak/kit/thanks.js)), over the game's own party: Mnot dancing on the summit, or the
downhill's finish party. **Raw numbers** on the card shows the table, with a **Copy** button. If sending fails, the
table stays up so the run can be pasted instead.

The game doesn't start: no title, no scores, no stats, and the pixel ratio stays at its first step, as with
`?manual`. The probe is the kit's ([`peak/kit/perf.js`](../peak/kit/perf.js)); each game gives it its spots, what's in
its scene and the card's words: the climb's [`peak/dev/perf.js`](../peak/dev/perf.js), the downhill's
[`peak/downhill/perf.js`](../peak/downhill/perf.js). `main.js` only loads it for `?perf`. `?manual&perf` (what the
headless run below uses) sends nothing. On the dev server, `?perf=thanks` shows the card straight away with made-up
numbers, for working on it, and `&fps=30` shows what a slower computer is told.

### The runs on the server

Each run is one JSON line in `DATA_DIR/perf.jsonl`, every game's in the one file, with the time, the game (`peak`,
`downhill`), the name from `by` and the whole table. [`server/perf.py`](../server/perf.py) keeps it, at most 6 runs
per address every 10 minutes. A file over 8 MB moves to `perf.1.jsonl`, so the newest runs are always kept. The
server's log gets one line per run: the game, the frame time, the fps, the graphics chip, the canvas and the name.

### Headless

With the dev server running:

```bash
node tools/perf.mjs --igpu --size 1512x945 --dpr 2 --out run.json
```

- `--game downhill` runs the downhill's (the page `downhill.html`); without it, the climb's.
- `--size` and `--dpr` set the window. `1512x945` at `--dpr 2` is a 15-inch laptop with a retina screen. The default
  is `1280x760` at dpr 1.
- `--igpu` asks the browser for the low-power GPU (Chromium's `--force_low_power_gpu`). On a desktop with an
  integrated GPU as well, this is a fair stand-in for a laptop.
- `--url` points at another server, for example an older checkout (see [Checking a change](#checking-a-change)).
- `--out` keeps the whole run as JSON.

It needs Playwright. Set `PLAYWRIGHT` to its `index.mjs` if it isn't installed in the folder, and `CHROME` to a
browser executable to use instead of Playwright's own.

## What the probe measures

1. **Spots.** On the climb, base camp, each checkpoint and the summit, each a jump there. At each spot it:
   - notes the first frame's time and how many shaders that frame had to build (it should be none: see the warm-up
     below);
   - plays 4 s as the game does, a step or a few and then a frame, and notes the fps, the 95th-percentile gap between
     frames, and our JS each frame (the game's `step` and `render()`);
   - holds still and times one frame with the GPU waited for, and counts its draw calls and triangles.

   On the downhill the autopilot rides the whole run in one go, and the spots are its stretches: the start, the
   crevasse, the ice, the moguls, the rollers, the river, the bowling lane, the ski jump, the office and the finish
   (3 s of the party). As the chair gets to each, it holds still and times a frame with the GPU waited for, and
   counts its draw calls and triangles; then it rides on to the next, noting the same as above, the worst gap
   between frames and the shaders built on the way. For the next two steps the chair is put back at the start of the
   slowest stretch, held still.
2. **The frame's parts**, held still at the slowest spot. It tries:
   - the pixel ratio, MSAA at 4×, 2× and none, and the depth copy after MSAA;
   - the shadow map held, or at half size;
   - the scene alone, the ink alone, the glow and the grade.

   `frame (again)` at the end should match `frame` at the top. If it doesn't, the run was noisy: run it again.
3. **Each thing in the scene.** The probe hides it and times the frame again; the difference is what it costs. For the
   four dearest it also times their painted pattern (each material's own shader code swapped for a plain copy),
   their casting of shadows, and the shadows falling on them.

### How it times

These rules come from tuning another three.js game. Each one made a misleading number honest.

- **Wait for the GPU.** A WebGL call returns long before the GPU has drawn. Without a wait you time the JS that
  queues the work. The probe draws one pixel onto the canvas and reads it back (`readPixels`), and that waits for
  everything drawn before it.
- **Warm up first.** The first draw with a material builds its shader. The probe applies each change once and draws
  before it starts timing.
- **ABBA.** For each change the probe times with, without, without, with, and averages. A GPU that clocks up or warms
  up during the run then doesn't favour either side. Compare two versions of the code the same way: old, new, new,
  old.
- **Small numbers are noise.** Below about 0.3 ms, and anything negative, is a draw.
- **A tab in the background is throttled.** The probe says so if it noticed.

## What it found

Measured in October 2026 on a desktop GPU (an RTX 5070 Ti) and on an integrated AMD Radeon in the same machine.

- **On a desktop GPU, the JS is the cost, not the picture.** The GPU needs about 1 ms a frame. `render()` takes
  1.3–2.3 ms of JS for 363–574 draw calls: three.js's work for each mesh, its outline and its shadow. The game's
  `step` takes about 0.4 ms. Every spot runs at the screen's rate.
- **On an integrated GPU, the pixels are the cost.** At a retina laptop's size (2268×1417 at pixel ratio 1.5) a frame
  took 34–36 ms. Pixel ratio 1 halves that and ratio 2 nearly doubles it, so the adaptive quality steps down. Most
  of the gains below show up there as a sharper picture, rather than as frames per second.
- **The rock pillars' paint was a third of the frame**: 12.6 ms, 11 of them its pattern. `materials.js` ran all its
  noise layers for every rock pixel, even under snow or deep in the haze.
- **The sky** cost 2.6–2.8 ms. It was drawn first, over the whole screen, and then mostly painted over.
- **Copying the multisampled depth out** after the scene cost about 2.5 ms, and nothing reads it.
- **The shadows weren't the problem.** Holding the shadow map, or halving it, changes nothing that can be measured.
  The glow and the grade take about 2 ms each, and the ink pass 2–4 ms.
- **Shaders were built on the way up.** Each one is built the first time something with its material comes into
  view. Arriving at checkpoint 1 built 6 shaders and took 217–279 ms; checkpoint 3 built 2 more.

## What paid off

On the integrated GPU at a retina laptop's size, timed ABBA in one session (old, new, new, old). Frames are in ms,
with the GPU waited for, at the slowest spot.

| Change | Where | Before | After |
|---|---|---|---|
| The rock shader skips what can't be seen | `look/materials.js` | rocks 12.6 / 12.7 | 4.0 / 4.4 |
| The sky is drawn after the solid things | `look/sky.js` | sky 2.8 / 2.6 | 0.3 / 0.5 |
| The multisampled depth isn't copied out | `look/post.js` | | about 2.5 less |
| Every shader is built behind the preloader | `main.js` | 6 + 2 shaders on the way | none |
| **The whole frame** | | **36.4 / 34.2** | **22.2 / 20.9** |
| **Each spot, played** | | **22–34 fps** | **34–47 fps** |

At 1280×760 the same GPU went from 65–92 fps to 95–120 fps. The slowest frame there went from 12.6 to 8.3 ms.

**The picture is unchanged.** Screenshots at seven spots were compared pixel for pixel, before and after. Only the
flags, which wave with time, and the checkpoint label differ, and they differ between any two runs. A speed-up that
changes the picture is a choice for the art director, not for this kind of pass.

### How

- **The rock shader** (`materials.js`) now:
  - works out the snow first, and skips the rock's layers, grain, cracks and lichen where the snow covers them
    completely (faces looking up, and the band just under the lip);
  - works out the snow's ragged edge only near it;
  - skips the rock's colour below y = −25, where the haze has taken over completely;
  - runs each detail layer only where its distance fade isn't zero.

  The derivatives (`fwidth`) are worked out before any branch, because GLSL needs them in uniform control flow.
- **The sky** (`sky.js`) has `renderOrder = 1`, so it comes after the solid things at 0. Its depth is the farthest
  there is, so where a rock already stands the GPU skips the sky's pixels. This is safe because every material that
  doesn't write depth is transparent, and three.js draws those after all the solid things anyway.
- **The scene buffer** (`post.js`) has `resolveDepthBuffer: false`. Nothing after the scene reads its depth: the ink
  is drawn in the same buffer, and the glow and the grade only read colour.
- **The warm-up** (`main.js`) draws one frame behind the preloader with nothing culled. All of the climb is drawn
  once, with its shadows and ink, and with the props in the copies that can dissolve (`props/fade.js`). A cold load
  takes about 0.3 s longer (2.0 → 2.3 s). In exchange, the first frames after the preloader lifts are smoother: the
  worst gap went from 25–33 ms to 17 ms, and nothing is built on the way up.

## Runs from other computers

These came in through `?perf` ([the runs on the server](#the-runs-on-the-server)), after the pass above.

### A MacBook with an Apple M4

Chrome 154 on a retina screen (dpr 2), measured October 2026: a 2205×1488 canvas at pixel ratio 1.5, the adaptive
quality's top step, with 4× MSAA.

- **It plays at a steady 60 fps** at every spot. The 95th-percentile gap is 16.8 ms, the screen's own rate, so
  nothing hitches. A frame takes the GPU 8–10 ms (checkpoint 2 is the slowest), which leaves about half the frame's
  time. Our JS takes under 3 ms a frame: `step` 0.8–1.1 ms, `render()` about 2 ms.
- **The pixels are the cost**, as on the integrated AMD. Held still at checkpoint 2:

  | What | ms a frame |
  |---|---|
  | As played: pixel ratio 1.5, 4× MSAA | 8.0 |
  | Pixel ratio 2, the screen's own | 13.8 |
  | Pixel ratio 1 | 3.9 |
  | 2× MSAA | 6.0 |
  | No MSAA | 3.9 |
  | The scene alone | 4.1 |
  | The ink alone | 4.4 |
  | The glow; the grade | 1.1; 0.3 |
  | The shadow map held; at 1024 | 8.2; 7.8 |

- **MSAA is half the frame here.** 4× costs about 4 ms over none, and 2× saves 2 of them.
- **The ink costs as much as the scene**: 4.4 ms against 4.1. On the integrated AMD it was 2–4 ms of a 21–36 ms
  frame.
- **The things in the scene hardly matter.** The dearest, the rock pillars, costs 1.3 ms and the snow 0.7 ms; the
  rest 0.3 ms or less. The shadows change nothing that can be measured.
- **Full retina would fit.** At pixel ratio 2 a frame takes 13.8 ms, under the 16.7 ms of a 60 Hz screen. But the
  adaptive quality starts at 1.5 (`RATIOS` in `look/post.js`), so the game never tries 2.

## The downhill

The downhill (`downhill.html`, [`peak/downhill/`](../peak/downhill/README.md)) is built on the climb's look, so it
starts with what paid off above: the rock shader that skips what can't be seen, the sky after the solid things, the
scene buffer without its depth copied out, the adaptive pixel ratio and the warm-up behind the preloader. Of the
loading it has the same: in the production build it's its own page with its own bundle (`downhill-*.js`, about
36 KiB gzipped), it loads only its own sounds (of the climb's effects only the wave, `MnotSounds({ effects })`), its
effects are AAC `.m4a` like the climb's (31 files, 1.28 MB of WAV to 236 KB), and its music waits for the first frame
and the sound's unlock.

Measured in October 2026 on the desktop GPU, in `downhill.html?manual` with the autopilot riding, a 1551×1441 canvas
at pixel ratio 2, at eleven spots from the gate to the finish:

- **It's light.** A frame with the GPU waited for takes 2.2–3.9 ms; `render()` 1.1–3.1 ms of JS for 172–650 draw
  calls and 0.45–1.05 million triangles, both the most near the top, where most of the run is in view. As on the climb, the
  JS is the cost on a desktop GPU.
- **Two shaders were still built on the way down**, though the warm-up drew every shader once. Both are fixed in the
  warm-up (`main.js`):
  - a painted prop far down the run, 82 s into the ride. `obstacles.update` hides whatever is more than 230 m ahead, so the
    warm-up never drew it. The warm-up now shows everything that's hidden, for its one frame (but no light: one more
    light would build every shader again);
  - a banner's shadow, 4 s in. three.js draws every shadow with one depth material, and builds that one's shader again
    only when the kind of mesh changes (Mnot's skinned can, the instanced ones), from whichever mesh comes first after
    the change. A painted mesh there (a banner, a sign) wants a shader of its own, so which shaders a frame needs
    depends on what the sun's shadow camera sees. The painted things that cast a shadow now get a depth material of
    their own, and the shared one only ever sees plain ones. The picture is the same, pixel for pixel, at four spots
    with and without it.

  After that, nothing was built in a whole ride, the finish party, a second ride, a respawn, and 19 crashes with 10
  lost casters.

### With `?perf`

`downhill.html?perf` came next, on the kit's probe. Measured in October 2026 on the same desktop GPU at 1280×760 (pixel
ratio 1, 4× MSAA), and on the integrated AMD Radeon at a retina laptop's size (2268×1417 at pixel ratio 1.5):

- **On the desktop GPU every stretch runs at the screen's rate**, 120 fps with a 95th-percentile gap of 8.4 ms. A
  frame takes the GPU 0.8–2.3 ms; our JS is `step` 0.3–0.5 ms and `render()` 1.7–3.4 ms, for 173–729 draw calls
  (the most at the ice, where most of the run is in view) and 0.45–1.05 million triangles. No shader is built on the
  way down. Nothing in the scene costs more than 0.7 ms (Mnot on the chair).
- **On the integrated GPU the pixels are the cost**, as on the climb. Held at pixel ratio 1.5 (in play the adaptive
  quality steps down) it plays at 39–49 fps, with frames of 17–29 ms; our JS takes the same 3–4.5 ms as on the
  desktop. The river is the dearest stretch (29–34 ms): there the gorge's rock walls, in the climb's painted rock,
  cost 9.4 ms, nearly all of it their pattern, and the cloud sea 5–7 ms. At pixel ratio 1 that frame takes 16 ms;
  2× MSAA saves 5 ms of it and no MSAA 11.
- **The ski jump's photo held its frame up.** The snowman's photo is drawn from its camera in the frame the chair
  flies past, then read off the canvas and made into a JPEG (`toDataURL`). Reading it back waited for the GPU: 2–5 ms
  on the desktop, 23–45 ms on the integrated one; and the first JPEG took 31 ms (50 on the integrated one). In the
  air off the ski jump, of all places, that was the only hitch over 25 ms in a whole ride: one frame with 28.5 ms
  of JS.

  `develop()` in the downhill's `main.js` now makes the photo without waiting: the GPU copies the middle of the canvas
  down to the photo's size (`blitFramebuffer`) and into a buffer (`readPixels` into a `PIXEL_PACK_BUFFER`), and that
  buffer is read once a fence says the GPU is done, a few frames on. The JPEG comes from a canvas kept off the GPU
  (`willReadFrequently`), so `toBlob` has nothing to read back and makes it off the main thread. The photo then shows
  in the corner as before, and on the finish card. Round the photo no frame takes longer now than in the same ride
  without it, on either GPU.

  A first try, `createImageBitmap` and `toBlob`, moved the JS off the frame but was worse on the integrated GPU:
  `toBlob` on a canvas that holds a GPU picture reads it back itself, on the main thread, 100–125 ms each time.
- **The probe's own timing showed up as a gap.** The first frame after the probe times a frame held still can carry
  a timestamp from before that timing, so the start's worst gap came out at 83–92 ms on the desktop and 750–890 ms on
  the integrated GPU, all of it the probe's. `watch()` in `kit/perf.js` now leaves out a frame that began before it did.
- **The chase camera after a jump down the run** (the probe's stretches, a test) looked down from 100 m up for a
  moment: its ground lookup started from where the chair had been. `snap()` in `camera.js` now looks for the snow
  under the chair afresh.

## Not done yet

In rough order of what they'd give, and what they'd cost:

- **2× MSAA instead of 4×.** About 2 ms on the integrated GPU (22.4 → 20.0), and no MSAA saves about 5 ms. On the
  M4, 2× takes a quarter off the frame (8.0 → 6.0 ms), and no MSAA half. Both make the edges rougher, so they're the
  art director's call. A lower setting on the slowest quality steps only is a middle way.
- **The rock pattern** still costs about 3 ms. Its noise could come from a small tiling 3D texture instead of being
  worked out per pixel. It would look nearly the same, but not exactly.
- **Draw calls.** There are 198 props, 89 other route meshes and 38 planks and ropes. Merging the static ones that
  share a material would cut `render()`'s JS, which is what holds a desktop back. `fade.js` dissolves props one by
  one, so merging needs to keep that.
- **The last shaders built in play:** the rockfall's (2–6 ms when the first rock falls) and the summit's confetti
  (22 ms, at the finish). Both could join the warm-up.
- **The backdrop:** the cloud sea and the range cost about 1.2 ms each on the integrated GPU.
- **The ink:** OutlineEffect draws the scene a second time (2–4 ms; on the M4 4.4 ms, as much as the scene itself).
  The far backdrop could skip it.
- **Pixel ratio 2 on a fast GPU.** The adaptive quality's top step is 1.5. An M4 has room for 2 (13.8 ms a frame),
  which would make a retina screen sharper. To keep slower computers safe, it could step up to 2 only after a stretch
  of frames well inside the budget.
- **Phones** haven't been measured on real hardware yet: `?perf` on a phone will tell. Phones start at ratio 1 and
  get a smaller shadow map (`post.js`).
- **The gorge's rock walls** at the river: 9.4 ms on the integrated GPU, a third of the frame, nearly all of it the
  rock pattern. The walls fill the screen there, close up, so the rock shader's layers run for nearly every pixel.
  Fewer layers on the gorge, or the 3D texture above, would cut it; both change the picture a little, so they're the
  art director's and look-dev's call.
- **The downhill's draw calls**: up to 729 at the ice, more than the climb's most (574). On a desktop GPU they're
  what `render()`'s JS spends its time on. Its obstacles, signs and props that share a material could be merged, as
  the climb's could; the snowmen (101 meshes) and the signs, banners and lines on the snow (111) are the most.
- **The climb's shadows** draw with the same shared depth material. Its warm-up built everything in play when it was
  measured, but its painted props could get a depth material of their own too, to be sure.

## Checking a change

1. Serve the code from before your change on a second port, next to the dev server:

   ```bash
   git archive HEAD | tar -x -C ../peak-before
   python -m http.server 5298 --directory ../peak-before
   ```

   Make the `../peak-before` folder first.
2. Time both ABBA: old, new, new, old. Use the same size and GPU each time, and keep the `--out` files.

   ```bash
   node tools/perf.mjs --igpu --size 1512x945 --dpr 2 --url http://127.0.0.1:5298/ --out a1.json
   node tools/perf.mjs --igpu --size 1512x945 --dpr 2 --out b1.json
   ```

3. Compare the pictures as well as the numbers: take screenshots at the same spots before and after.
4. Run the usual checks ([docs/agents.md](agents.md#checks-before-handing-over)).
