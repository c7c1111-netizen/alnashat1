// بناء المنصة إلى مجلد ../platform (يُنشر على GitHub Pages كما هو).
// يستخدم esbuild مباشرة (نفس ما يسويه Vite داخليًا في البناء). مع Vite: npm run build.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(root, '..', 'platform');
const nodePaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  minify: true,
  sourcemap: false,
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  outdir: path.join(out, 'assets'),
  entryNames: 'app',
  chunkNames: 'chunk-[hash]',
  splitting: true,
  nodePaths,
  legalComments: 'none',
  logLevel: 'info',
});

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, f.name), d = path.join(dst, f.name);
    if (f.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
copyDir(path.join(root, 'public'), out);
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));

// قائمة ملفات الواجهة للعمل بدون إنترنت
const files = [];
(function walk(dir, rel = '') {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${f.name}` : f.name;
    if (f.isDirectory()) walk(path.join(dir, f.name), r);
    else if (r !== 'sw.js') files.push(`./${r}`);
  }
})(out);
const version = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8')
  .replace('__BUILD_VERSION__', version)
  .replace('__PRECACHE__', JSON.stringify(['./', ...files], null, 1));
fs.writeFileSync(path.join(out, 'sw.js'), sw);
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ version, builtAt: new Date().toISOString() }));
console.log(`✓ built ${files.length} files → ${path.relative(process.cwd(), out)} (v${version})`);
