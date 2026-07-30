import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for bim-assistant PoC.
//
// `npm run dev` from the project root is the deployment.
// No Cloud Function proxy, no Firebase — env vars come from
// .env.local via Vite's import.meta.env.VITE_* exposure.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    host: true,
    fs: {
      // Vite root is the project root, so `..` is unnecessary.
      // We allow `..` defensively in case someone re-roots the
      // project for some reason.
      allow: [".."],
    },
  },
  optimizeDeps: {
    // pdfjs-dist 4.x uses top-level await in its main entry
    // (build/pdf.mjs). esbuild's default target es2020 rejects
    // TLA, so we raise it to esnext for the dev prebundle.
    esbuildOptions: {
      target: "esnext",
    },
  },
  build: {
    outDir: "dist",
    // Sourcemaps off: the IFC + TOE bundle is ~7.5 MB and
    // sourcemaps nearly double peak memory during bundling,
    // which OOMs the build on machines with <8 GB free RAM.
    sourcemap: false,
    // pdfjs-dist 4.x uses top-level await (build/pdf.mjs).
    target: "esnext",
    rollupOptions: {
      output: {
        // Split the heavy BIM deps into separate chunks so
        // Rollup can process them sequentially instead of one
        // 7+ MB monolith. Same manual-chunks split as
        // bim-specs-mapper; reduces peak heap during build.
        manualChunks: {
          toe: [
            "three",
            "@thatopen/components",
            "@thatopen/components-front",
            "@thatopen/fragments",
          ],
          pdfjs: ["pdfjs-dist"],
        },
      },
    },
  },
});
