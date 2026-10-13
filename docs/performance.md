# Performance

What the climb costs to draw, how to measure it on any computer, what the first pass found, and what's left to try.

## Measuring

### In a browser

Open [`peak.html?perf`](https://peakmnot.mosredna.eu/peak.html?perf) (or `http://127.0.0.1:5280/peak.html?perf` on
the dev server). It takes about a minute: keep the tab in front and leave it be. At the end there's a table with a
**Copy** button; paste it wherever you're asking for help. Nothing is sent anywhere.

The game doesn't start: no title, no scores, no stats, and the pixel ratio stays at its first step, as with
`?manual`. [`peak/dev/perf.js`](../peak/dev/perf.js) is the probe; `main.js` only loads it for `?perf`.

### Headless

With the dev server running:

```bash
node tools/perf.mjs --igpu --size 1512x945 --dpr 2 --out run.json
```

- `--size` and `--dpr` set the window. `1512x945` at `--dpr 2` is a 15-inch laptop with a retina screen. The default
  is `1280x760` at dpr 1.
- `--igpu` asks the browser for the low-power GPU (Chromium's `--force_low_power_gpu`). On a desktop with an
  integrated GPU as well, this is a fair stand-in for a laptop.
- `--url` points at another server, for example an older checkout (see [Checking a change](#checking-a-change)).
- `--out` keeps the whole run as JSON.

It needs Playwright. Set `PLAYWRIGHT` to its `index.mjs` if it isn't installed in the folder, and `CHROME` to a
browser executable to use instead of Playwright's own.

## What the probe measures

1. **Spots.** Base camp, each checkpoint and the summit. At each spot it:
   - notes the first frame's time and how many shaders that frame had to build (it should be none: see the warm-up
     below);
   - plays 4 s as the game does, a step or a few and then a frame, and notes the fps, the 95th-percentile gap between
     frames, and our JS each frame (the game's `step` and `render()`);
   - holds still and times one frame with the GPU waited for, and counts its draw calls and triangles.
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

## Not done yet

In rough order of what they'd give, and what they'd cost:

- **2× MSAA instead of 4×.** About 2 ms on the integrated GPU (22.4 → 20.0), and no MSAA saves about 5 ms. Both make
  the edges rougher, so they're the art director's call. A lower setting on the slowest quality steps only is a
  middle way.
- **The rock pattern** still costs about 3 ms. Its noise could come from a small tiling 3D texture instead of being
  worked out per pixel. It would look nearly the same, but not exactly.
- **Draw calls.** There are 198 props, 89 other route meshes and 38 planks and ropes. Merging the static ones that
  share a material would cut `render()`'s JS, which is what holds a desktop back. `fade.js` dissolves props one by
  one, so merging needs to keep that.
- **The last shaders built in play:** the rockfall's (2–6 ms when the first rock falls) and the summit's confetti
  (22 ms, at the finish). Both could join the warm-up.
- **The backdrop:** the cloud sea and the range cost about 1.2 ms each on the integrated GPU.
- **The ink:** OutlineEffect draws the scene a second time (2–4 ms). The far backdrop could skip it.
- **Phones** haven't been measured on real hardware yet: `?perf` on a phone will tell. Phones start at ratio 1 and
  get a smaller shadow map (`post.js`).

## Checking a change

1. Serve the code from before your change on a second port, next to the dev server:

   ```bash
   git archive HEAD | tar -x -C ../peak-before
   python -m http.server 5294 --directory ../peak-before
   ```

   Make the `../peak-before` folder first.
2. Time both ABBA: old, new, new, old. Use the same size and GPU each time, and keep the `--out` files.

   ```bash
   node tools/perf.mjs --igpu --size 1512x945 --dpr 2 --url http://127.0.0.1:5294/ --out a1.json
   node tools/perf.mjs --igpu --size 1512x945 --dpr 2 --out b1.json
   ```

3. Compare the pictures as well as the numbers: take screenshots at the same spots before and after.
4. Run the usual checks ([docs/agents.md](agents.md#checks-before-handing-over)).
