# Easy Proto handoff

The initial planning baseline is `ef19dde671914306580adb693f32434a09eb1f73`. The verified runtime revision is `3ff6fc8b7262f7069b7c9c70508b03851dc91cfa`. The initial specialist review targeted `907207053e9fc21b255610658ec4c6351fc2ce33`.

[Setup and demonstration](../readme.md) covers the pinned install, launching the app, connecting Codex, and running verification. [Project commits](decisions/0002-project-commits.md) defines the save and retry contract. [Preview and MCP](decisions/0003-preview-and-mcp.md) records the local authority and capture boundaries.

## Observed acceptance

The clean export ran on Apple Silicon macOS 27.0.1 (26A434), using Node 24.16.0, pnpm 10.33.4, Electron 45.3.2, Chromium 156.0.8078.100 and MCP TypeScript SDK 1.32.2 (Streamable HTTP 2025-11-25). Run `EASY_PROTO_EVIDENCE="$PWD/evidence" pnpm verify` from an installed checkout.

| Criterion | Observed check |
| --- | --- |
| 1. Development app launches | Electron showed the starter HTML in an artboard. |
| 2. MCP create appears | The SDK client created an artboard and Playwright observed its heading in the canvas. |
| 3. MCP update changes rendering | Playwright observed the new heading and computed background. Live canvas panned, zoomed, selected and committed pointer and keyboard movement while retaining its frame and 320 px CSS width. |
| 4. Capture identifies revision and viewport | Capture returned revision and source revision 4, source and asset digests, and a 320 × 240 PNG with the expected background pixel. The native 640 × 480 capture was normalized. The result reported a missing asset, a corrupt CSS image, a query-string image failure, a corrupt font and a blocked resource. It recorded media preferences and device pixel ratio. A capture held during an MCP update retained the earlier revision and pixels. A synthetic stalled readiness check returned a timeout and cleaned up its window. |
| 5. Save and reopen preserve work | Quit and opened the same folder again. Verified HTML, CSS, position, size and visible document. |
| 6. Retry preserves the original outcome | Equal create and update retries replayed the original results after reopen. The project still had two boards and revision 4 before the later overlap and lost-response cases. Reusing the command ID with a different request was rejected. One SDK transport discarded its original create reply. Quit, reopen and retry found the same committed board. A subprocess killed just after publication also replayed its result on restart. |
| 7. Stale edits are rejected | The stale request failed while newer HTML remained unchanged. Concurrent same-base commands produced one commit and one conflict. |
| 8. Tested preview cannot access app privileges | Fixture had no bridge, Node globals, parent document access or executable script/inline handler. External image, nested frame and resource hints made zero connections to the synthetic loopback observer. Local image loaded. Direct file URLs, encoded traversal and off-preview navigation were refused. Symlinked and hard-linked project files were rejected. The capture renderer had an opaque origin and neither the app bridge nor Node globals. |

Storage checks also verify a failed write, unsupported schema refusal, missing-pointer refusal, and whole-state recovery before and after pointer publication. The [risk register](risks.md) describes broader evidence expectations.

## Scope and remaining verification

The SDK client supplied the acceptance MCP traffic. Codex CLI 0.167.0-alpha.4.1 discovered the endpoint in a separate disposable session. Its tool approval policy blocked the first call because that noninteractive run prohibited prompts. In an interactive Codex session, approve the Easy Proto tool calls when prompted. Independent platform evidence is limited to the Apple Silicon Mac above. Forge packaging, power-loss testing, representative load measurements and an interactive preview mode belong to later work.

## Independent reviews

The coordinator ran the application checks against disposable Git exports. Reviewers used fresh Codex CLI contexts with read-only runtime permission. The [final verification log](../evidence/3ff6fc8b7262f7069b7c9c70508b03851dc91cfa/verify.log), [exit status](../evidence/3ff6fc8b7262f7069b7c9c70508b03851dc91cfa/exit-status.txt), [observed stages](../evidence/3ff6fc8b7262f7069b7c9c70508b03851dc91cfa/desktop-stages.json), [canvas](../evidence/3ff6fc8b7262f7069b7c9c70508b03851dc91cfa/canvas.png) and [returned PNG](../evidence/3ff6fc8b7262f7069b7c9c70508b03851dc91cfa/artboard.png) are retained locally.

| Review findings | Disposition and owner |
| --- | --- |
| EP-SEC-001 and EP-SEC-002 | Security verified both fixes on the runtime revision. The project reader refuses multiply linked files. Both preview contexts preserve canonical source and bound preview depth. [Security report](../evidence/3ff6fc8b7262f7069b7c9c70508b03851dc91cfa/security-report.md) |
| FE-001 to FE-003 | Frontend verified all three fixes on the runtime revision, including persisted keyboard movement, matching live and captured fixture rendering, and complete labels at both window sizes. [Frontend report](../evidence/3ff6fc8b7262f7069b7c9c70508b03851dc91cfa/frontend-report.md) |
| AR-001 to AR-003 | Architecture and Reliability verified the read-only readiness probe, named CSS image diagnostics and observed media settings on the runtime revision. [Architecture and Reliability report](../evidence/3ff6fc8b7262f7069b7c9c70508b03851dc91cfa/architecture-reliability-report.md) |
| AR-004 | The coordinator updated this handoff with the fixed runtime revision, finding dispositions and owners. |

## Project picker

Runtime revision `e0736bf501dda60cd56e6b715ec46b447e4044e1` adds **New Project** and **Open Project** to the toolbar. The [project selection decision](decisions/0004-project-selection.md) defines picker behavior and the required MCP activation ID.

The Mac verification used the same SDK client through multiple switches. It demonstrated that stale read, create, update, and capture calls fail, including when two folders share a project ID and revision. An in-progress capture returned no image, and the old preview URL returned 404. A same-folder reopen waited for an already-admitted write, loaded the new revision, and replayed the command under fresh authority. Cancellation and invalid choices kept the current project and activation. The native sheet was also walked manually for creation and reopening an existing saved revision. [Verification log](../evidence/e0736bf501dda60cd56e6b715ec46b447e4044e1/verify.log) · [Observed stages](../evidence/e0736bf501dda60cd56e6b715ec46b447e4044e1/desktop-stages.json) · [Native picker check](../evidence/e0736bf501dda60cd56e6b715ec46b447e4044e1/native-picker.md)

The fixed revision passed independent Security and Architecture and Reliability reviews with no findings in the focused scope. Both reviews used read-only exports. [Security report](../evidence/e0736bf501dda60cd56e6b715ec46b447e4044e1/security-report.md) · [Architecture and Reliability report](../evidence/e0736bf501dda60cd56e6b715ec46b447e4044e1/architecture-reliability-report.md)

## Artboard resizing and appearance

Runtime revision `826196be9785bf8e1b3579e6f6253d9f6c6e534f` adds a bottom-right resize control to selected artboards. Drag updates the iframe during the gesture. Release saves through the shared command service, and Escape cancels. The focused handle takes arrow keys, with Shift for larger steps. Keyboard focus pans a clipped handle into view and keeps it visible as the board grows. Camera controls pause while a pointer resize is active. The project folder format and MCP tool schemas are unchanged.

The clean Apple Silicon macOS run observed a 320 × 240 iframe and the compact CSS layout before and after camera zoom. The displayed width scaled from about 246 to 296 screen CSS pixels. Dragging then changed the browser viewport to 448 × 285 and triggered the wide layout before release, with the same iframe and source revision. The suite also observed a saved keyboard step, canceled drag, stale resize rollback against a newer MCP width, and matching capture and reopened dimensions. During a drag, camera buttons, modifier-wheel zoom and Space-wheel pan left the camera fixed, and attempting to select another board kept the active handle available.

The desktop uses locally bundled Inter and neutral semantic tokens for Light and Dark. **Appearance** also follows System and reacts to preference changes. Explicit overrides last for the current app session. The Design Lead role and critique playbook now require the [desktop design guidance](design-guidance.md) for interface changes. [Verify log](../evidence/826196be9785bf8e1b3579e6f6253d9f6c6e534f/verify.log) · [Observed stages](../evidence/826196be9785bf8e1b3579e6f6253d9f6c6e534f/desktop-stages.json) · [Light](../evidence/826196be9785bf8e1b3579e6f6253d9f6c6e534f/artboard-resize-light.png) · [Dark](../evidence/826196be9785bf8e1b3579e6f6253d9f6c6e534f/artboard-resize-dark.png)

The focused reports verify closure of the design, gesture, revision and geometry findings. Frontend and Architecture and Reliability passed on `826196b`, including normal wheel zoom after Space is released during a resize. Design verified the focus and theme behavior on `4366f4f`. Security verified the geometry-only bridge and preview font isolation on `3dc3203`. Infrastructure passed the font packaging and guidance review on `1e7f0df`. The later revisions preserved those reviewed code paths. [Frontend](../evidence/826196be9785bf8e1b3579e6f6253d9f6c6e534f/frontend-report.md) · [Architecture and Reliability](../evidence/826196be9785bf8e1b3579e6f6253d9f6c6e534f/architecture-reliability-report.md) · [Design](../evidence/4366f4f027d7a55277918bcb89f1f27b20e10713/design-report.md) · [Security](../evidence/3dc3203017174d244af98bea838ba30a12566e71/security-report.md) · [Infrastructure](../evidence/1e7f0df7a5390ab9f598c14c1478d4af23a95cc3/infrastructure-report.md)

## Next bounded task

Add an artboard duplication action. Verify the copy gets a new stable ID, independently editable source, and a position offset through a single saved command.
