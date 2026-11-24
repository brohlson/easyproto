import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";

process.env.CLOUDFLARE_DEV_REGISTRY_PATH ??= fileURLToPath(
  new URL("../../.local/cloudflare-registry", import.meta.url),
);
process.env.CHOKIDAR_USEPOLLING ??= "1";

export default defineConfig({
  plugins: [cloudflare({ inspectorPort: false })],
  publicDir: "out",
  server: {
    host: "127.0.0.1",
    port: 8787,
    strictPort: true,
    fs: {
      // Preserve Vite's defaults and protect local capabilities and persisted project data.
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "**/.local/**",
        "**/.dev.vars*",
        "**/.cloudflare/**",
        "**/.next/**",
        "**/.workspace/**",
        "**/.easy-proto/**",
        "**/*.easyproto",
      ],
    },
  },
});
