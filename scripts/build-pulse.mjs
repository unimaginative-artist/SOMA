#!/usr/bin/env node
/**
 * Precompile the Pulse IDE.
 *
 * frontend/public/pulse_standalone.html stays the editable source. Served as-is, every page
 * load downloaded Babel standalone plus development builds of React and compiled ~420KB of
 * JSX in the browser. This script compiles that JSX once with esbuild, swaps in production
 * React, drops Babel, and writes the result to frontend/dist (which the backend serves).
 *
 *   node scripts/build-pulse.mjs        (rebuild-frontend.bat runs it after the vite build)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = createRequire(path.join(root, 'frontend', 'package.json'))('esbuild');
const sourcePath = path.join(root, 'frontend', 'public', 'pulse_standalone.html');
const distDir = path.join(root, 'frontend', 'dist');

const html = fs.readFileSync(sourcePath, 'utf8');
const OPEN = '<script type="text/babel">';
const CLOSE = '</script>';
const start = html.indexOf(OPEN);
const end = start >= 0 ? html.indexOf(CLOSE, start) : -1;
if (start < 0 || end < 0) throw new Error('Pulse source has no <script type="text/babel"> block');

const t0 = Date.now();
// 1) JSX -> plain JS
const plainJs = esbuild.transformSync(html.slice(start + OPEN.length, end), {
  loader: 'jsx',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  target: 'es2020',
  charset: 'utf8',
}).code;

// 2) let/const -> var. In-browser Babel always did this, which silently tolerates places where
//    Pulse reads a variable before its declaration. Keeping modern const turns those into
//    "Cannot access X before initialization" crashes, so match the behavior Pulse has always had.
const buildTools = createRequire(path.join(root, 'scripts', 'pulse-build-tools', 'package.json'));
const babel = buildTools('@babel/core');
const scopedJs = babel.transformSync(plainJs, {
  sourceType: 'script',
  babelrc: false,
  configFile: false,
  compact: false,
  plugins: [buildTools.resolve('@babel/plugin-transform-block-scoping')],
}).code;

// 3) minify
const { code } = esbuild.transformSync(scopedJs, {
  loader: 'js',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
});

const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
const appFile = `pulse_app.${hash}.js`;
let out = html.slice(0, start) + `<script src="${appFile}"></script>` + html.slice(end + CLOSE.length);

const swaps = [
  [/<script src="https:\/\/unpkg\.com\/react@18\.3\.1\/umd\/react\.development\.js"[^>]*><\/script>/,
    '<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin="anonymous"></script>'],
  [/<script src="https:\/\/unpkg\.com\/react-dom@18\.3\.1\/umd\/react-dom\.development\.js"[^>]*><\/script>/,
    '<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous"></script>'],
  [/<script src="https:\/\/unpkg\.com\/@babel\/standalone@[^"]+"[^>]*><\/script>\s*/, ''],
];
for (const [pattern, replacement] of swaps) {
  if (!pattern.test(out)) throw new Error(`Expected tag not found in Pulse source: ${pattern}`);
  out = out.replace(pattern, replacement);
}

fs.mkdirSync(distDir, { recursive: true });
for (const file of fs.readdirSync(distDir)) {
  if (/^pulse_app\.[0-9a-f]+\.js$/.test(file) && file !== appFile) fs.rmSync(path.join(distDir, file));
}
fs.writeFileSync(path.join(distDir, appFile), code);
fs.writeFileSync(path.join(distDir, 'pulse_standalone.html'), out);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`[build-pulse] ${appFile} ${kb(code.length)} (from ${kb(end - start)} JSX), html ${kb(out.length)}, ${Date.now() - t0}ms`);
