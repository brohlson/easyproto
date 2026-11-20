import { fileURLToPath } from "node:url";

export default {
  packagerConfig: {
    appBundleId: "io.github.brohlson.easyproto",
    icon: fileURLToPath(new URL("./assets/app-icon.icns", import.meta.url)),
    prune: false,
    ignore: [/^\/forge\.config\.mjs$/, /^\/assets(?:\/|$)/],
    osxSign: {
      identity: "-",
      identityValidation: false,
      continueOnError: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      // This local ad hoc build has no Developer ID team for framework validation.
      optionsForFile: () => ({ hardenedRuntime: false }),
    },
  },
};
