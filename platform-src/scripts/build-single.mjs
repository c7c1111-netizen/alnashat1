// بناء نسخة «ملف HTML واحد» من المنصة: الكود والتنسيق والبيانات وقالب Word كلها داخل ملف واحد
// يفتح مباشرة من الملفات على الآيباد أو الكمبيوتر بدون إنترنت.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outFile = process.argv[2] || path.resolve(root, '..', 'platform', 'منصة-النشاط-الطلابي.html');
const pub = path.join(root, 'public');

const res = await build({
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true, format: 'iife', target: ['es2020', 'safari15'], minify: true, write: false,
  jsx: 'automatic', loader: { '.js': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' },
  outdir: 'out', nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), legalComments: 'none',
});
const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = res.outputFiles.find((f) => f.path.endsWith('.css')).text;

const json = {};
(function walk(dir, rel) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = `${rel}/${f.name}`;
    if (f.isDirectory()) walk(path.join(dir, f.name), r);
    else if (f.name.endsWith('.json')) json[r.slice(1)] = JSON.parse(fs.readFileSync(path.join(dir, f.name), 'utf8'));
  }
})(path.join(pub, 'data'), '/data');
const bin = { 'templates/official-plan.docx': fs.readFileSync(path.join(pub, 'templates/official-plan.docx')).toString('base64') };
const icon = `data:image/svg+xml;base64,${fs.readFileSync(path.join(pub, 'icons/icon.svg')).toString('base64')}`;
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f4c4a">
<link rel="icon" href="${icon}">
<title>منصة النشاط الطلابي</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>window.__EMBED__=${safe(JSON.stringify({ json, bin }))};</script>
<script>${safe(js)}</script>
</body>
</html>`;
fs.writeFileSync(outFile, html);
console.log(`✓ ${path.basename(outFile)} — ${(html.length / 1024 / 1024).toFixed(2)} MB`);
