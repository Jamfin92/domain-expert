import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const PSQ_PORT = process.env.PSQ_PORT ?? "8092";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    // The browser only ever talks to the dev server; /api is proxied to the
    // API process, so there is no CORS story in development or production.
    proxy: { "/api": { target: `http://127.0.0.1:${PSQ_PORT}`, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
