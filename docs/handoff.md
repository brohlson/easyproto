# Easy Proto handoff

The initial planning baseline is `ef19dde671914306580adb693f32434a09eb1f73`. The first independently exported runtime candidate was `907207053e9fc21b255610658ec4c6351fc2ce33`.

[Setup and demonstration](../readme.md) covers the pinned install, launching the app, connecting Codex, and running verification. [Project commits](decisions/0002-project-commits.md) defines the save and retry contract. [Preview and MCP](decisions/0003-preview-and-mcp.md) records the local authority and capture boundaries.

## Observed acceptance

The clean export ran on Apple Silicon macOS 27.0.1 (26A434), using Node 24.16.0, pnpm 10.33.4, Electron 45.3.2, Chromium 156.0.8078.100 and MCP TypeScript SDK 1.32.2 (Streamable HTTP 2025-11-25). Run `EASY_PROTO_EVIDENCE="$PWD/evidence" pnpm verify` from an installed checkout.

| Criterion | Observed check |
| --- | --- |
| 1. Development app launches | Electron showed the starter HTML in an artboard. |
| 2. MCP create appears | The SDK client created an artboard and Playwright observed its heading in the canvas. |
| 3. MCP update changes rendering | Playwright observed the new heading and computed background. Live canvas panned, zoomed, selected and committed pointer and keyboard movement while retaining its frame and 320 px CSS width. |
| 4. Capture identifies revision and viewport | Capture returned revision and source revision 4, source and asset digests, and a 320 × 240 PNG with the expected background pixel. The native 640 × 480 capture was normalized. The result reported a missing synthetic asset and a blocked resource. |
| 5. Save and reopen preserve work | Quit and opened the same folder again. Verified HTML, CSS, position, size and visible document. |
| 6. Retry preserves the original outcome | Equal create and update retries replayed the original results after reopen. The project still had two boards and revision 4 before the later overlap and lost-response cases. Reusing the command ID with a different request was rejected. A subprocess killed just after publication also replayed its result after restart. |
| 7. Stale edits are rejected | The stale request failed while newer HTML remained unchanged. Concurrent same-base commands produced one commit and one conflict. |
| 8. Tested preview cannot access app privileges | Fixture had no bridge, Node globals, parent document access or executable script/inline handler. External image, nested frame and resource hints made zero connections to the synthetic loopback observer. Local image loaded. Direct file URLs, encoded traversal and off-preview navigation were refused. Symlinked and hard-linked project files were rejected. |

Storage checks also verify a failed write, unsupported schema refusal, missing-pointer refusal, and whole-state recovery before and after pointer publication. The [risk register](risks.md) describes broader evidence expectations.

## Scope and remaining verification

The SDK client supplied the live MCP traffic. The installed Codex CLI accepted the documented Streamable HTTP/bearer configuration shape in its help output. An agent-driven Codex call was not part of the acceptance fixture. Independent platform evidence is limited to the Apple Silicon Mac above. Forge packaging, power-loss testing, representative load measurements and an interactive preview mode belong to later work.

## Independent reviews

Reports for the first candidate and the revised candidate are under `evidence/<full Git revision>/`. The coordinator ran the application checks against disposable Git exports. Reviewers used fresh Codex CLI contexts with read-only runtime permission. Track critical and major findings until the revised candidate has matching independent verification.

## Next bounded task

Add an in-app project picker for opening existing projects and creating new ones. Preserve the one-writer and project-scoped MCP boundaries during a project switch. Verify switching, reopening from the picker, and rejection of a request from the prior project.
