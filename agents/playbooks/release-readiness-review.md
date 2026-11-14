# Release readiness review

Use this procedure for a planned desktop release or changes to packaging, distribution, supported runtimes, or hosting. Apply the [review protocol](../review-protocol.md).

1. Identify the candidate revision, target platform, artifact, and required checks. Confirm the review and evidence refer to that candidate.
2. Build from a clean environment with the documented runtime and lockfile. Record the command, environment, result, and artifact identity.
3. Smoke-test launch, project creation, MCP connection, capture, save, close, and reopen using the packaged application.
4. Check runtime assets, production configuration, secret exclusion, process shutdown, and diagnostic handling.
5. Verify supported document migrations and recovery after a failed update. A previous binary is useful only if it can safely handle the current document format or the documented backup.
6. For published snapshots, verify upload authorization, asset completeness, content isolation, and the stated access and revocation behavior.

Report required evidence that is missing or stale. Never mark an unbuilt platform as tested. Keep release approval distinct from deployment authority; the review itself does not authorize publishing or changing external infrastructure.
