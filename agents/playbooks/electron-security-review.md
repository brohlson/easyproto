# Electron security review

Use this procedure when preview rendering, preload APIs, protocols, navigation, asset loading, or privileged operations change. Apply the [review protocol](../review-protocol.md).

1. Identify trusted application code, generated content, imported files, and the privileged operations reachable from each.
2. Inspect effective renderer settings, sandboxing, context isolation, content policies, permission handlers, and exposed bridges. Confirm that mockups receive no privileged application bridge.
3. Trace messages and URLs through validation. Check unexpected frame senders, navigation, popups, custom schemes, and malformed inputs where reachable.
4. Test project-file containment with synthetic traversal, encoded-path, symlink, and asset-reference fixtures. Verify the policy for imported resources and outbound requests.
5. Confirm secrets and project contents do not appear in error messages or default logs.

Record runtime configuration and a bounded reproduction or concrete code path for each finding. Run adversarial fixtures only in an approved disposable environment. Do not read real secrets or probe outside the authorized project. Missing evidence for a changed privilege boundary blocks approval of that boundary; unrelated hardening suggestions remain advisory.
