// إعداد Vite: يبني إلى ../platform ويستخدم مسارات نسبية عشان يشتغل تحت /alnashat1/platform/
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../platform',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'assets/app.js', assetFileNames: 'assets/app.[ext]' } },
  },
});
