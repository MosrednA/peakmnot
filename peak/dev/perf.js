// The perf probe, for peak.html?perf: times how this computer draws the climb (docs/performance.md says how to read
// it, and what it found). main.js loads it instead of starting the game (no title, no scores, no stats, the picture
// held at its first pixel ratio). It puts Mnot at base camp, at each checkpoint and on the summit, and watches a few
// seconds of frames at each, run as the game runs them. Then, held still at the spot that took longest, it times the
// frame's parts one by one with the GPU waited for (the pixel ratio, MSAA, the scene, its ink, the shadows, the glow,
// the grade) and what each thing in the scene costs. It ends with a table to copy. tools/perf.mjs runs it headless.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { look } from './bots.js';

const FRAMES = 30;          // frames timed for each line
const WATCH = 4;            // seconds of frames watched at each spot

const ABOUT = 'Peak Mnot perf probe: times how this computer draws the climb. It takes about a minute: keep this tab ' +
  'in front and leave it be. Nothing is sent anywhere; copy the table at the end.';

const wait = ms => new Promise(done => setTimeout(done, ms));
const now = () => performance.now();
const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const at = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)] ?? 0;
const ms = v => v.toFixed(1).padStart(6);

export async function probe(peak) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;max-width:min(620px,calc(100vw - 16px));' +
    'max-height:calc(100vh - 16px);overflow:auto;padding:10px 12px;border-radius:10px;background:rgba(20,22,40,0.88);' +
    'color:#fffaf0;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap';
  document.body.append(box);
  const say = text => { box.textContent = `${ABOUT}\n\n${text}`; };
  try {
    const text = await measure(peak, say);
    console.log(text);
    box.textContent = text;
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.style.cssText = 'position:sticky;bottom:0;float:right;margin-top:6px;padding:4px 12px;border-radius:999px;' +
      'border:0;cursor:pointer';
    copy.onclick = () => navigator.clipboard.writeText(text).then(() => { copy.textContent = 'Copied'; });
    box.append(copy);
  } catch (error) {
    say(`Perf probe failed: ${error?.stack ?? error}`);
    window.peakPerf = { error: String(error?.stack ?? error) };
  }
}

// Runs the game for `seconds` as main.js's frame loop does (a step or a few, then a frame), noting the gaps between
// frames and our JS in each: the game's steps and render().
async function watch(peak, seconds) {
  const w = { gaps: [], step: [], render: [] };
  const post = peak.post, render = post.render;
  let drawing = 0;
  post.render = function () { const t = now(); render.call(this); drawing += now() - t; };
  try {
    await new Promise(done => {
      let first = 0, last = 0;
      const frame = t => {
        if (last) {
          const dt = Math.min((t - last) / 1000, 0.05), n = Math.max(1, Math.ceil(dt * 60 - 1e-6));
          w.gaps.push(t - last);
          drawing = 0;
          const start = now();
          peak.step(dt, dt / n);
          w.step.push(now() - start - drawing);
          w.render.push(drawing);
        } else first = t;
        last = t;
        if (t - first < seconds * 1000) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
  } finally {
    post.render = render;
  }
  return w;
}

// What's in the scene, by thing: the route's parts (rocks, beams, props, the rest) and what hangs in the scene itself.
function things({ scene, world, mnot, weather }) {
  const rocks = new Set(world.blockers), beams = new Set(world.beams.map(b => b.mesh)), all = new Map();
  const add = (label, o) => (all.get(label) ?? all.set(label, []).get(label)).push(o);
  for (const o of world.group.children) {
    if (!o.visible) continue;
    add(rocks.has(o) ? 'rock pillars' : beams.has(o) ? 'planks and ropes' : o.userData.fade ? 'props' :
      'the rest of the route (boards, ledges, signs, gondolas, ice)', o);
  }
  const names = new Map([[mnot.root, 'Mnot'], [weather.flakes.points, 'snow'],
    [weather.streaks.lines, 'wind streaks']]);
  for (const o of scene.children) {
    if (o === world.group || !o.visible || o.isLight || !(o.isMesh || o.isPoints || o.isLine || o.children.length)) {
      continue;
    }
    add(names.get(o) ?? (o.name || `a ${o.type}`), o);
  }
  return all;
}

const meshes = parts => {
  const list = [];
  for (const p of parts) p.traverse(o => { if (o.isMesh) list.push(o); });
  return list;
};

async function measure(peak, say) {
  const { renderer: r, scene, camera, world, post } = peak;
  // A tab in the background gets few frames and a slower GPU: the run says so.
  let hidden = document.hidden;
  const hide = () => { hidden ||= document.hidden; };
  document.addEventListener('visibilitychange', hide);
  const gl = r.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const composer = post.composer, [ink, glow, grade] = composer.passes, shot = composer.readBuffer;
  const sun = scene.children.find(o => o.isDirectionalLight);

  // Waits until the GPU has drawn `into` (null: the canvas). readPixels alone isn't enough on Apple's GPUs, which
  // return once the canvas is ready: so a one-pixel draw onto the canvas reads `into` first.
  const px = new Uint8Array(4);
  const touch = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv;' +
      'void main() { gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, 1.0); }',
  }));
  const finish = into => {
    r.setRenderTarget(null);
    if (into) {
      touch.material.uniforms.tDiffuse.value = into;
      r.setScissorTest(true);
      r.setScissor(0, 0, 1, 1);
      touch.render(r);
      r.setScissorTest(false);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };
  const time = (draw, into = null, frames = FRAMES) => {
    for (let i = 0; i < 3; i++) draw();
    finish(into);
    const t = now();
    for (let i = 0; i < frames; i++) draw();
    finish(into);
    return (now() - t) / frames;
  };
  const counted = () => {
    r.info.autoReset = false;
    r.info.reset();
    post.render();
    const { calls, triangles } = r.info.render;
    r.info.autoReset = true;
    return { calls, triangles };
  };

  // Each spot: the first frame there (with the shaders it had to build), then a few seconds as the game runs.
  say('Perf probe: letting the climb settle…');
  peak.step(1);
  await wait(1500);
  const spots = world.checkpoints.map((cp, i) => ({ label: i ? `checkpoint ${i}` : 'base camp', at: cp.respawn,
    yaw: cp.yaw }));
  if (world.summit) spots.push({ label: 'summit', at: world.summit.at, yaw: 0 });
  for (const spot of spots) {
    say(`Perf probe: watching ${WATCH} s at ${spot.label}…`);
    const programs = r.info.programs.length, t = now();
    look(peak, spot.at.toArray(), spot.yaw);
    finish(null);
    Object.assign(spot, { first: now() - t, built: r.info.programs.length - programs });
    await wait(200);
    spot.watched = await watch(peak, WATCH);
    look(peak, spot.at.toArray(), spot.yaw);
    spot.frame = time(() => post.render());
    Object.assign(spot, counted());
  }

  // The dearest spot, held still, timed part by part.
  const worst = spots.reduce((a, b) => (b.frame > a.frame ? b : a));
  look(peak, worst.at.toArray(), worst.yaw);
  await wait(500);
  const lines = [];
  const step = async (label, draw, { into = shot.texture, before, after } = {}) => {
    say(`Perf probe: ${label}…`);
    await wait(60);
    before?.();
    try {
      lines.push([label, time(draw, into)]);
    } finally {
      after?.();
    }
  };
  const ratio = post.ratio, samples = shot.samples;
  const setRatio = x => { r.setPixelRatio(x); composer.setPixelRatio(x); };
  const setSamples = n => {
    for (const target of [composer.renderTarget1, composer.renderTarget2]) { target.samples = n; target.dispose(); }
  };
  const frame = () => post.render();
  const scenePass = () => { r.setRenderTarget(shot); r.render(scene, camera); };
  const inked = () => ink.render(r, null, shot);
  const inkOnly = () => { r.setRenderTarget(shot); ink.outline.renderOutline(scene, camera); };
  const mapSize = sun.shadow.mapSize.x;
  const setMap = size => { sun.shadow.mapSize.setScalar(size); sun.shadow.map?.dispose(); sun.shadow.map = null; };
  const held = { before: () => { r.shadowMap.autoUpdate = false; }, after: () => { r.shadowMap.autoUpdate = true; } };
  const costs = [];
  try {
    await step('frame', frame, { into: null });
    for (const x of [2, 1.5, 1, 0.7].filter(x => x !== ratio && x <= Math.max(1, devicePixelRatio))) {
      await step(`frame at pixel ratio ${x}`, frame, { into: null, before: () => setRatio(x),
        after: () => setRatio(ratio) });
    }
    for (const n of [4, 2, 0].filter(n => n !== samples)) {
      await step(n ? `frame, ${n}× MSAA` : 'frame, no MSAA', frame, { into: null, before: () => setSamples(n),
        after: () => setSamples(samples) });
    }
    const resolving = shot.resolveDepthBuffer;
    await step(`frame, depth ${resolving ? 'not ' : ''}copied out after MSAA`, frame, { into: null,
      before: () => { shot.resolveDepthBuffer = !resolving; }, after: () => { shot.resolveDepthBuffer = resolving; } });
    await step('frame, shadow map held', frame, { into: null, ...held });
    await step(`frame, shadow map ${mapSize / 2}`, frame, { into: null, before: () => setMap(mapSize / 2),
      after: () => setMap(mapSize) });
    await step('clear only', () => { r.setRenderTarget(shot); r.clear(); });
    await step('scene + ink (InkPass)', inked);
    await step('  scene (shadow pass, colour, MSAA)', scenePass);
    await step('  scene, shadow map held', scenePass, held);
    await step('  ink only (the outline pass)', inkOnly);
    await step('glow (bloom)', () => glow.render(r, null, shot), { into: glow.texture });
    await step('grade, onto the screen', () => grade.render(r, null, shot), { into: null });

    // Each thing: the scene with it, then without, then without and with again, so a slow drift counts on both
    // sides; whatever a change has to build is drawn once before the timing.
    const saves = change => {
      const shotTime = () => time(inked, shot.texture, FRAMES / 2);
      let undo = change();
      inked();
      undo();
      undo = null;
      shotTime();
      const with1 = shotTime();
      undo = change();
      try {
        const without = shotTime() + shotTime();
        undo();
        undo = null;
        return (with1 + shotTime() - without) / 2;
      } finally {
        undo?.();
      }
    };
    const hiding = parts => () => {
      const was = parts.map(o => o.visible);
      for (const o of parts) o.visible = false;
      return () => parts.forEach((o, i) => { o.visible = was[i]; });
    };
    const counting = parts => {
      let draws = 0, tris = 0;
      for (const m of meshes(parts)) {
        const g = m.geometry, n = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
        draws++;
        tris += n * (m.isInstancedMesh ? m.count : 1);
      }
      return { draws, tris };
    };
    for (const [label, parts] of things(peak)) {
      say(`Perf probe: what ${label} costs…`);
      await wait(30);
      costs.push({ label, parts, v: saves(hiding(parts)), more: [], ...counting(parts) });
    }
    costs.sort((a, b) => b.v - a.v);
    // The dearest: what of that is their painted pattern (a plain toon material instead), and their shadows.
    for (const cost of costs.slice(0, 4)) {
      const all = meshes(cost.parts);
      say(`Perf probe: what ${cost.label} pays for…`);
      await wait(30);
      const patterned = all.filter(m => !Array.isArray(m.material) && !m.material.isShaderMaterial &&
        Object.hasOwn(m.material, 'onBeforeCompile'));
      if (patterned.length) {
        const plain = new Map();
        const plainOf = m => plain.get(m) ?? plain.set(m, m.clone()).get(m);    // clone() leaves the shader hook
        const v = saves(() => {
          const was = patterned.map(m => m.material);
          for (const m of patterned) m.material = plainOf(m.material);
          return () => patterned.forEach((m, i) => { m.material = was[i]; });
        });
        for (const m of plain.values()) m.dispose();
        cost.more.push(`pattern ${v.toFixed(1)}`);
      }
      for (const [key, as] of [['castShadow', 'casting shadow'], ['receiveShadow', 'shadows on it']]) {
        if (!all.some(m => m[key])) continue;
        const v = saves(() => {
          const was = all.map(m => m[key]);
          for (const m of all) m[key] = false;
          return () => all.forEach((m, i) => { m[key] = was[i]; });
        });
        cost.more.push(`${as} ${v.toFixed(1)}`);
      }
    }
    await step('frame (again)', frame, { into: null });
  } finally {
    setRatio(ratio);
    r.shadowMap.autoUpdate = true;
    touch.dispose();
  }
  document.removeEventListener('visibilitychange', hide);

  const ua = navigator.userAgent.match(/(Firefox|Edg|Chrome|Version)\/[\d.]+/g)?.join(' ') ?? navigator.userAgent;
  const spotLine = s => {
    const w = s.watched, fps = w.gaps.length ? 1000 / avg(w.gaps) : 0;
    return `${s.label.padEnd(13)} ${fps.toFixed(0).padStart(4)} fps · gap p95 ${at(w.gaps, 0.95).toFixed(1)} · ` +
      `step ${avg(w.step).toFixed(2)} · render() ${avg(w.render).toFixed(1)} · frame ${s.frame.toFixed(1)} ms · ` +
      `${s.calls} draws, ${Math.round(s.triangles / 1000)}k tris · first frame ${s.first.toFixed(0)} ms` +
      (s.built ? ` (${s.built} shaders built)` : '');
  };
  const text = [
    `Peak Mnot perf · ${ua}`,
    gpu,
    `dpr ${devicePixelRatio} · canvas ${r.domElement.width}×${r.domElement.height} · pixel ratio ${ratio} · ` +
      `MSAA ${samples}× · shadow map ${mapSize} · ${r.info.programs.length} shaders`,
    ...(hidden ? ['this tab was in the background for part of the run: some timings may be off'] : []),
    '',
    `Each spot, played for ${WATCH} s (our JS a frame: the game's step and render()), then held still (frame: the`,
    'GPU waited for):',
    ...spots.map(spotLine),
    '',
    `ms per frame at ${worst.label}, GPU waited for:`,
    ...lines.map(([label, v]) => `${ms(v)}  ${label}`),
    '',
    'ms each thing costs (the scene and its ink with it, less without it; for the dearest, what of that is its',
    'painted pattern, casting its shadow and the shadows on it):',
    ...costs.map(({ label, v, more, draws, tris }) => `${ms(v)}  ${label} · ${draws} mesh${draws === 1 ? '' : 'es'}, ` +
      `${tris < 1000 ? '<1' : Math.round(tris / 1000)}k tris${more.length ? `  (${more.join(', ')})` : ''}`),
  ].join('\n');
  window.peakPerf = {
    text, gpu, ua: navigator.userAgent, dpr: devicePixelRatio, canvas: [r.domElement.width, r.domElement.height],
    ratio, samples, hidden, lines, things: costs.map(({ label, v, draws, tris, more }) => ({ label, v, draws, tris,
      more })),
    spots: spots.map(({ label, first, built, frame, calls, triangles, watched: w }) => ({ label, first, built, frame,
      calls, triangles, fps: 1000 / avg(w.gaps), gapP95: at(w.gaps, 0.95), step: avg(w.step), render: avg(w.render) })),
  };
  return text;
}
