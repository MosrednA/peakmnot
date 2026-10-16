// The production build: each game's page with its code bundled and minified by esbuild, written with everything it
// loads to dist/, the site as the score server serves it in production (server/README.md, "Production"). Nothing
// here is needed for development: the pages run straight from the source, with three.js from the CDN in their
// import maps (README.md, "Run it yourself").
//   npm ci          once: esbuild and three.js, the versions in package.json
//   npm run build   or node tools/build.mjs
//
// - One entry per game: the page's own <script type="module" src>. Code that more than one game uses lands in
//   shared chunks, so a browser that played one game has most of the other already.
// - three.js is built on its own: 'three' is assets/three-HASH.js and the addons the games use are one file,
//   assets/three-addons-HASH.js. They only change with three.js or the list of addons, so a browser keeps them
//   across releases. (main.js puts THREE on window.peak, so all of three.js is loaded either way.)
// - Every file in dist/assets/ is named by its content: a new release gets new names, and the server lets
//   browsers keep these files for good.
// - A file the code loads by new URL('…', import.meta.url) (the sounds, the music, the perf card's styles) is copied
//   in with a hashed name too. A template like `audio/${id}.m4a` brings every file it can name of the TYPES the
//   server serves.
// - The page's stylesheets become one file; the import map and the dev server's live reload are dropped.
import * as esbuild from 'esbuild';
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'dist');
// The games, one page each: a new game is one more line here (and its page in STATIC in server/peak_scores.py).
// Then the page of all the games and the viewer, at /games and /viewer (PAGES in server/peak_scores.py).
// A page's name (without .html) names its code: peak.html loads assets/peak-HASH.js.
const PAGES = [
  'peak.html',
  'downhill.html',
  'emoji.html',
  'games.html',
  'index.html',
];
// Linked from the pages by name, copied as they are
const FILES = ['favicon.png', 'favicon.ico', 'share.jpg', 'share-downhill.jpg', 'share-emoji.jpg', 'share-games.jpg',
  'manifest.webmanifest', 'models/mnot.glb'];
// What the score server serves from assets/ (HASHED in server/peak_scores.py): a name, esbuild's hash, a type
const TYPES = ['js', 'css', 'm4a', 'mp3', 'wav', 'jpg', 'webp'];
const SERVED = new RegExp(`^assets/[a-z0-9_-]+-[A-Z2-7]{8}\\.(${TYPES.join('|')})$`);

const posix = file => file.split(path.sep).join('/');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter(e => e.isFile()).map(e => path.join(e.parentPath, e.name));
}

async function replaceAsync(text, pattern, replace) {
  const done = await Promise.all([...text.matchAll(pattern)].map(m => replace(...m)));
  let i = 0;
  return text.replace(pattern, () => done[i++]);
}

// new URL('file', import.meta.url) and new URL(`dir/${name}.ext`, import.meta.url) in our modules: each file becomes
// an asset, which esbuild names by its content and writes next to the code, and the URL its name
const URL_LITERAL = /new URL\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const URL_TEMPLATE = /new URL\(\s*`([^`]*\$\{[^`]*)`\s*,\s*import\.meta\.url\s*\)/g;
const assets = {
  name: 'assets',
  setup(build) {
    // by its path from the root: esbuild's names hash it, so the names don't change with where the checkout is
    build.onResolve({ filter: /^asset:/ }, args => ({ path: args.path.slice('asset:'.length), namespace: 'asset' }));
    build.onLoad({ filter: /.*/, namespace: 'asset' }, async args => ({
      contents: await readFile(path.join(ROOT, args.path)), loader: 'file' }));
    build.onLoad({ filter: /\.js$/ }, async args => {
      if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
      const source = await readFile(args.path, 'utf8');
      if (!source.includes('import.meta.url')) return undefined;
      const dir = path.dirname(args.path), imports = [];
      const asset = file => {
        const id = `asset:${posix(path.relative(ROOT, file))}`;
        imports.push(`import __asset${imports.length} from ${JSON.stringify(id)};`);
        return `__asset${imports.length - 1}`;
      };
      const missing = what => {
        throw new Error(`${posix(path.relative(ROOT, args.path))}: no file for new URL(${what}, import.meta.url)`);
      };
      let code = await replaceAsync(source, URL_LITERAL, async (match, quote, url) => {
        const file = path.resolve(dir, url);
        await access(file).catch(() => missing(`${quote}${url}${quote}`));
        return `new URL(${asset(file)}, import.meta.url)`;
      });
      code = await replaceAsync(code, URL_TEMPLATE, async (match, template) => {
        // each ${…} stands for part of a file name: list the files it can name, by the URL as written
        const parts = template.split(/\$\{[^}]*\}/);
        const folder = parts[0].slice(0, parts[0].lastIndexOf('/') + 1);
        const pattern = new RegExp(`^${parts.map(escape).join('[^/]+')}$`);
        const names = (await filesUnder(path.resolve(dir, folder)))
          .map(file => [`${folder}${posix(path.relative(path.resolve(dir, folder), file))}`, file])
          .filter(([url]) => pattern.test(url) && TYPES.includes(path.extname(url).slice(1)));
        if (!names.length) missing(`\`${template}\``);
        const table = names.map(([url, file]) => `${JSON.stringify(url)}: ${asset(file)}`).join(', ');
        return `new URL({ ${table} }[\`${template}\`], import.meta.url)`;
      });
      return { contents: `${imports.join('\n')}\n${code}`, loader: 'js' };
    });
  },
};

// three.js, built apart from the games: the addons in one file that imports three.js, and the games importing both
// by their built names
const addons = list => ({
  name: 'addons',
  setup(build) {
    build.onResolve({ filter: /^three-addons$/ }, () => ({ path: 'three-addons', namespace: 'addons' }));
    build.onLoad({ filter: /.*/, namespace: 'addons' }, () => ({ resolveDir: ROOT, loader: 'js',
      contents: list.map(s => `export * from ${JSON.stringify(s)};`).join('\n') }));
  },
});
const three = files => ({
  name: 'three',
  setup(build) {
    build.onResolve({ filter: /^three(\/|$)/ }, args => {
      if (args.path === 'three') return { path: `./${files.three}`, external: true };
      if (!files.addons) return undefined;      // building the addons themselves
      if (args.path.startsWith('three/addons/')) return { path: `./${files.addons}`, external: true };
      throw new Error(`${args.importer}: the build has no place for '${args.path}' (tools/build.mjs, three)`);
    });
  },
});

// a page's stylesheets, in order, as one
const styles = sheets => ({
  name: 'styles',
  setup(build) {
    build.onResolve({ filter: /^page-css:/ }, args => ({ path: args.path.slice('page-css:'.length),
      namespace: 'page-css' }));
    build.onLoad({ filter: /.*/, namespace: 'page-css' }, args => ({ resolveDir: ROOT, loader: 'css',
      contents: sheets.get(args.path).map(href => `@import ${JSON.stringify(`./${href}`)};`).join('\n') }));
  },
});

function readPage(file, html) {
  const entry = html.match(/<script type="module" src="([^"]+)"><\/script>/)?.[1];
  if (!entry) throw new Error(`${file}: no <script type="module" src="…">`);
  const version = html.match(/cdn\.jsdelivr\.net\/npm\/three@([\d.]+)\//)?.[1];
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="((?!https?:)[^"]+)">/g)].map(m => m[1]);
  return { name: path.basename(file, '.html'), entry, version, sheets };
}

const started = performance.now();
const version = JSON.parse(await readFile(path.join(ROOT, 'node_modules/three/package.json'), 'utf8')).version;
const pages = [];
for (const file of PAGES) {
  const html = await readFile(path.join(ROOT, file), 'utf8');
  const page = { file, html, ...readPage(file, html) };
  if (page.version && page.version !== version) {
    throw new Error(`${file} runs three.js ${page.version} in development but npm has ${version}: `
      + 'change package.json to match');
  }
  pages.push(page);
}

// a quick pass for the three.js addons the games import
const entries = Object.fromEntries(pages.map(p => [p.name, path.join(ROOT, p.entry)]));
const scan = await esbuild.build({ entryPoints: entries, bundle: true, splitting: true, format: 'esm', outdir: OUT,
  absWorkingDir: ROOT, write: false, metafile: true, logLevel: 'error' });
const used = [...new Set(Object.values(scan.metafile.inputs).flatMap(input => input.imports)
  .map(i => i.original).filter(s => /^three\/addons\//.test(s ?? '')))].sort();

await rm(OUT, { recursive: true, force: true });
const common = { bundle: true, minify: true, format: 'esm', outdir: OUT, absWorkingDir: ROOT, metafile: true,
  charset: 'utf8', logLevel: 'warning',
  entryNames: 'assets/[name]-[hash]', chunkNames: 'assets/chunk-[hash]', assetNames: 'assets/[name]-[hash]' };
const lib = await esbuild.build({ ...common, entryPoints: { three: 'three' } });
const files = { three: path.basename(Object.keys(lib.metafile.outputs)[0]) };
const extra = await esbuild.build({ ...common, entryPoints: { 'three-addons': 'three-addons' },
  plugins: [addons(used), three(files)] });
files.addons = path.basename(Object.keys(extra.metafile.outputs)[0]);
const code = await esbuild.build({ ...common, entryPoints: entries, splitting: true, plugins: [three(files), assets] });
const css = await esbuild.build({ ...common, plugins: [styles(new Map(pages.map(p => [p.name, p.sheets])))],
  entryPoints: Object.fromEntries(pages.filter(p => p.sheets.length).map(p => [p.name, `page-css:${p.name}`])) });

const outputs = Object.assign({}, ...[lib, extra, code, css].map(result => result.metafile.outputs));
const served = out => path.posix.relative('dist', out);     // the metafile's paths: relative to ROOT, with /
for (const out of Object.keys(outputs)) {
  if (!SERVED.test(served(out))) {
    throw new Error(`${out}: the server wouldn't serve this name (SERVED here, HASHED in server/peak_scores.py)`);
  }
}
const entryOf = (meta, name, ext) => Object.keys(meta.outputs).find(out => {
  const o = meta.outputs[out];
  return out.endsWith(ext) && o.entryPoint && (o.entryPoint === `page-css:${name}`
    || path.resolve(ROOT, o.entryPoint) === entries[name]);
});
// the files a page's code imports before it runs, preloaded with the page so they don't wait for each other
function staticImports(out, seen = new Set()) {
  for (const i of outputs[out].imports) {
    const file = i.external ? path.posix.join(path.posix.dirname(out), i.path) : i.path;
    if (i.kind === 'import-statement' && !seen.has(file)) { seen.add(file); staticImports(file, seen); }
  }
  return seen;
}

for (const page of pages) {
  const js = entryOf(code.metafile, page.name, '.js');
  if (!js) throw new Error(`${page.file}: esbuild wrote no code for ${page.entry}`);
  const sheet = page.sheets.length ? served(entryOf(css.metafile, page.name, '.css')) : null;
  let first = true, html = page.html
    .replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '')
    .replace(/<script>(?:(?!<\/script>)[\s\S])*__dev_version[\s\S]*?<\/script>\n?/, '')
    .replace(/<link rel="stylesheet" href="(?!https?:)[^"]+">\n?/g, () => {
      const link = first ? `<link rel="stylesheet" href="${sheet}">\n` : '';
      first = false;
      return link;
    })
    .replace(/<script type="module" src="[^"]+"><\/script>/, `<script type="module" src="${served(js)}"></script>`);
  const preloads = [...staticImports(js)].map(out => `<link rel="modulepreload" href="${served(out)}">\n`).join('');
  html = html.replace('</head>', `${preloads}</head>`);
  if (/\b(src|href)="peak\//.test(html)) throw new Error(`${page.file}: still links into peak/ after the build`);
  await writeFile(path.join(OUT, page.file), html);
}
for (const file of FILES) {
  await mkdir(path.dirname(path.join(OUT, file)), { recursive: true });
  await copyFile(path.join(ROOT, file), path.join(OUT, file));
}

// what came out, and what it weighs over the wire (text goes gzipped)
const rows = [];
for (const file of await filesUnder(OUT)) {
  const data = await readFile(file);
  const text = /\.(html|js|css|webmanifest)$/.test(file);
  rows.push([posix(path.relative(OUT, file)), data.length, text ? gzipSync(data).length : data.length]);
}
rows.sort((a, b) => b[1] - a[1]);
const kb = n => `${(n / 1024).toFixed(1)} KiB`.padStart(11);
for (const [file, size, zipped] of rows) console.log(`${kb(size)} ${kb(zipped)}  ${file}`);
const total = rows.reduce((t, [, s, z]) => [t[0] + s, t[1] + z], [0, 0]);
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`${kb(total[0])} ${kb(total[1])}  dist/: ${rows.length} files, built in ${seconds} s`);
