import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "easy-proto-web",
    entrypoint: "./worker/index.ts",
    compatibilityDate: "2026-11-23",
    assets: { notFoundHandling: "single-page-application", runWorkerFirst: true },
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ id: "00000000-0000-4000-8000-000000000001", name: "easy-proto-web-local" }),
      PREVIEWS: bindings.r2({ name: "easy-proto-previews-local" }),
      LOCAL_PUBLISH_TOKEN: bindings.secret(),
    },
    observability: { enabled: true, redactQueryString: true, traces: { enabled: true } },
  },
});
