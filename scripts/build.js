import { build } from 'esbuild';
import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

async function main() {
  if (existsSync(DIST)) {
    await rm(DIST, { recursive: true, force: true });
  }
  await mkdir(DIST, { recursive: true });

  // The export renderer runs in its own iframe (see src/render.js), so it's
  // a separate bundle whose filename the main bundle is told at build time.
  const renderResult = await build({
    entryPoints: [path.join(ROOT, 'src/render.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    outdir: DIST,
    entryNames: 'render-[hash]',
    metafile: true,
    target: ['es2022'],
    logLevel: 'info',
  });
  const renderFilename = path.basename(Object.keys(renderResult.metafile.outputs).find((p) => p.endsWith('.js')));

  const result = await build({
    define: { __RENDER_URL__: JSON.stringify(renderFilename) },
    entryPoints: [path.join(ROOT, 'src/main.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    outdir: DIST,
    entryNames: 'bundle-[hash]',
    external: ['three', 'three/addons/*'],
    metafile: true,
    sourcemap: false,
    target: ['es2022'],
    logLevel: 'info',
  });

  const outputPaths = Object.keys(result.metafile.outputs);
  const jsOutput = outputPaths.find((p) => p.endsWith('.js'));
  if (!jsOutput) {
    throw new Error('esbuild did not produce a .js output file: ' + JSON.stringify(outputPaths));
  }
  const bundleFilename = path.basename(jsOutput);

  await cp(path.join(ROOT, 'images'), path.join(DIST, 'images'), { recursive: true });
  await cp(path.join(ROOT, '.htaccess'), path.join(DIST, '.htaccess'));

  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const SCRIPT_TAG_RE = /<script\s+type="module"\s+src="src\/main\.js"\s*><\/script>/;
  if (!SCRIPT_TAG_RE.test(html)) {
    throw new Error('Could not find <script type="module" src="src/main.js"></script> in index.html');
  }
  const newHtml = html.replace(SCRIPT_TAG_RE, `<script type="module" src="${bundleFilename}"></script>`);
  await writeFile(path.join(DIST, 'index.html'), newHtml, 'utf8');

  console.log(`Build complete: dist/index.html -> ${bundleFilename}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
