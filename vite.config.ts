import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import process from "node:process";

export default defineConfig({
  plugins: [react(), cloudflare({ configPath: process.env.MOVILOQ_WRANGLER_CONFIG ?? "wrangler.jsonc" })],
  server: {
    port: 5173
  }
});
