import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    // three.js alone is ~1 MB minified; this is a desktop app, not a website.
    chunkSizeWarningLimit: 2000,
  },
});
