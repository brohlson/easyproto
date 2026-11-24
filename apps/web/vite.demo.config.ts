import { defineConfig } from "vite";
import { desktopTokens } from "./desktop-tokens-plugin";

export default defineConfig({
  plugins: [desktopTokens()],
  esbuild: { jsx: "automatic" },
  build: { assetsInlineLimit: 0 },
});
