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

## Minimal Home design and artboard activity

EasyProtoMocks contains two Home states and a canvas activity mockup. The [design handoff](dogfooding.md) records their MCP capture revisions. The running desktop shows a steady **Agent working** label with three animated dots while the affected preview fades from full opacity to 80% and back over three seconds. The [MCP workflow](../readme.md#connect-an-external-agent) explains how an agent signals drafting between calls.

The macOS verification used a real SDK connection. It observed the opacity cycle on only the active preview, staggered dots, reduced-motion behavior, overlapping and expiring activity, in-flight capture, and activity removal when another project opens. The artboard document stayed mounted, and explicitly setting activity kept the same saved pointer. The pinned capture retained its expected revision and pixels. The Light and Dark checks cover both the toolbar and the rendered canvas background. [Verification log](../evidence/artboard-opacity/verify.log) · [Observed stages](../evidence/artboard-opacity/desktop-stages.json) · [Light canvas](../evidence/artboard-opacity/artboard-activity.png) · [Dark canvas](../evidence/artboard-opacity/artboard-activity-dark.png)

Architecture/Security and Design/Frontend reviewers inspected the earlier activity implementation in source export with SHA-256 `d691c01ddbe983fdb1ae76f159814c73207ccafafe789b4ffa5406ad4a11d0bd` against `c6d8157` and reported no blocking findings. The native reviewers inspected a read-only copy within the shared runner. A missing-board update can publish redundant scene events without displaying an indicator. The opacity, dots and theme changes received a self-review using live Light and Dark captures at the default window size. Extreme zoom and VoiceOver with the live indicator remain unchecked.

## Home and workspace controls

The desktop opens Home with a Create project action and a list of locally opened projects. A project row reopens its folder. Settings contains Home, Create project, Open project, and Appearance. The project and artboard names support inline editing. The project display name travels with the folder, and editing it leaves the folder path intact. The canvas keeps title, dimensions, and activity text at fixed screen sizes. Labels can overlap in dense layouts at low zoom, and selected or focused boards have stacking priority.

The macOS checks use disposable projects and a real MCP SDK connection. They cover the empty Home, creation from the picker, renaming and cancellation, stable iframe size and identity across zoom, persisted names on relaunch, and recovery after moving a folder. Returning Home revokes the old MCP activation and live preview URL. The [project selection decision](decisions/0004-project-selection.md) describes compatibility and recovery.

[Verification log](../evidence/home-workspace/verify.log) · [Empty Home](../evidence/home-workspace/home-empty.png) · [Project list](../evidence/home-workspace/home-projects.png) · [Settings](../evidence/home-workspace/workspace-settings.png)

Architecture/Security and Design/Frontend inspected frozen export `b74f571450d47baf56a26cb051992e04bb08debe619ff79ce0129e726091a903` against base `c6d8157`. No blocking findings were reported. The coordinator added malformed-name recovery guidance and selected-label priority in response to advisory findings. Visual evidence for the new Home covers Light at the default window size.

## Device presets and settings

Click the dimensions above an artboard to choose a preset. The phone and tablet sizes follow the [Chromium DevTools device list](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/emulation/EmulatedDevices.ts). Desktop sizes are fixed design viewports. The existing document command saves width and height, so a preset affects the preview and capture at the same CSS dimensions. Existing custom dimensions still open as saved and can be updated through MCP.

The canvas uses scroll or pinch to zoom and Shift+0 to fit. Settings uses a borderless Lucide cog and shows the three appearance choices directly, with a checkmark for the active choice. All five macOS checks passed. They verified keyboard selection and focus restoration, the selected-size checkmark, an unchanged iframe across size updates, media-query switching, stale edit rejection, and matching capture and reopened dimensions. Both menus were inspected in Light and Dark, and preset popup bounds were checked at 660 × 480. [Verification log](../evidence/device-presets/verify.log) · [Preset picker](../evidence/device-presets/device-presets-dark-minimum.png) · [Settings](../evidence/device-presets/settings-dark.png)

## Artboard duplication

Command-D duplicates the selected artboard and selects the copy. One saved command gives the copy a new stable ID, independent HTML and CSS, and a 40-unit offset on each axis. Repeated copies skip occupied positions along the diagonal. Existing project assets stay shared. The shortcut is inactive while editing text or using a menu.

The Apple Silicon macOS check exercised Command-D in Electron, edited the copy through the MCP SDK, confirmed the original source stayed the same, and reopened the saved project. The storage check confirmed replay, stale-revision rejection, and valid offsets at the canvas limit. [Verification log](../evidence/artboard-duplication/verify.log) · [Canvas](../evidence/artboard-duplication/artboard-duplicate.png)

## Artboard clipboard and history

Command-C captures the selected artboard as it exists at copy time. Command-V creates a new offset copy in the same open project. Undo and redo cover up to 50 artboard changes, including edits from MCP. Each action saves a new revision. The history and artboard clipboard expire on leaving or reopening the project. Text inputs retain their own shortcuts. See [project commits](decisions/0002-project-commits.md) for version 2 compatibility.

The macOS checks cover native copy and paste in a disposable Electron project, keyboard undo and redo, independent copy source, and reopening after undo removed a pasted board. Storage verification covers replay of an older command after undo, copied source remaining frozen through a later edit, and redo clearing on new edits. [Verification log](../evidence/artboard-history/verify.log)

## Artboard deletion

Delete removes the selected artboard in one saved revision. Command-Z restores it in its original position and order, with the same ID and source. Shift-Command-Z removes it again. The shortcut leaves text editing alone.

All nine Apple Silicon macOS checks passed. The Electron check verified both Delete key variants, Undo, Redo, MCP lookup and preview URL retirement, and reopening after removal. The storage check verified restoration and replay of a retried delete. [Verification log](../evidence/artboard-deletion/verify.log) · [Restored artboard](../evidence/artboard-deletion/artboard-restored.png)

## Preview fade

A newly mounted or replaced preview stays transparent until its iframe loads, then fades in over 180 ms. Reduced Motion reveals the loaded preview immediately. Geometry and selection stay visible during loading, and canvas moves and zoom retain the loaded frame. [Verification log](../evidence/artboard-preview-fade/verify.log)

## Artboard multi-select

The working tree based on `df2f2eb` adds Shift-click and selection by dragging a box from the empty canvas. Space-drag pans. Drag, arrow keys, duplicate, copy and paste, and delete work on the selection. A group edit saves one revision and takes one undo step. Group copies share an offset and have independent IDs and source. The first group commit writes [project schema version 3](decisions/0002-project-commits.md).

All ten `pnpm verify` checks passed on Apple Silicon macOS 27.0.1. Electron exercised selection by click and box, group drag and keyboard movement, duplicate, paste, delete, undo, redo, and reopen. Storage verification covered source identity after movement, matching group outcomes on retry after reopening, and rejection of invalid or stale commands without a partial edit. The Architecture and Reliability specialist consulted on the schema and command contract during implementation. The commit checks record the fixed candidate and independent reviews. [Commit checks](../evidence/multi-select-commit/) · [Selection box](../evidence/artboard-multiselect/artboard-marquee.png) · [Light](../evidence/artboard-multiselect/artboard-multi-select.png) · [Dark](../evidence/artboard-multiselect/artboard-multi-select-dark.png)

At revision 224, EasyProtoMocks occupied about 24 MB across 2,462 files. Manifests accounted for about 21 MB. A ZIP of the whole project measured 4.7 MB. A ZIP with the current snapshot, pointer, and project metadata measured 35 KB. A bounded storage follow-up is to prototype a compressed `.easyproto` export of the current snapshot and verify that importing it reproduces the document.

The selection box now includes partially overlapped artboards. The group outline and individual selection outlines use the same outside stroke width. Electron verified a drag crossing only parts of two boards, excluded a third board, and checked all four outline edges at two zoom levels. All ten checks passed on Apple Silicon macOS on rerun after an initial timeout in the single-board drag check. [Verification log](../evidence/artboard-selection-edges/verify.log) · [Partial overlap](../evidence/artboard-selection-edges/artboard-marquee.png) · [Aligned outline](../evidence/artboard-selection-edges/artboard-selection-outline.png)

## Trackpad panning

Two-finger swipes and mouse scrolling pan the canvas on both axes. Pinch zoom and Space-drag remain available. Electron automation sent horizontal and vertical wheel events over an artboard and measured the camera translating on each axis at a fixed scale. Pinch-equivalent input changed the scale. All ten checks passed on Apple Silicon macOS. Physical trackpad input is available to try in the running app. [Verification log](../evidence/canvas-trackpad-pan/verify.log) · [Measured camera positions](../evidence/canvas-trackpad-pan/desktop-stages.json)

The commit review covers the same group outline after Shift-click, marquee, duplicate, paste and undo. A plain click on a selected member narrows the selection to that board. Escape clears the selection, and the focused artboard name gets an underline during keyboard navigation. The storage regressions exercise fractional positions at the canvas limits, recovery on each side of the first v3 publication, and group copies in a narrow range of possible offsets. [Commit verification and review](../evidence/multi-select-commit/)

## Project pages

The page name beside the project title opens the Pages picker. Add page saves and opens a new canvas. To move a selection, choose **Move to page** in the footer. The source page stays open and the confirmation offers **Go to page**. Switching restores the page's camera during the session and clears selection. Creation and group moves use the project undo history. Existing projects open on Page 1 and upgrade on the first page creation. [Project format and recovery](decisions/0002-project-commits.md#pages)

The macOS Electron check exercised page creation with the keyboard, camera restoration, default and explicit MCP destinations, a two-artboard move and single-step undo and redo, page creation undo and redo, and quitting and reopening. Storage checks interrupted the first v4 save before and after publication, verified legacy receipt replay after upgrade, and rejected invalid page membership. [Verification log](../evidence/pages-picker/verify.log) · [Pages picker](../evidence/pages-picker/pages-picker.png) · [Move to page](../evidence/pages-picker/move-to-page.png) · [Confirmation](../evidence/pages-picker/page-move-confirmation.png)

## Project-wide tokens

The working tree based on `a33b9e4` adds a Tokens editor, an Import/Export workflow and the authenticated `get_tokens` and `replace_project_tokens` tools. The first token edit upgrades the project to schema v5. The atomic snapshot saves the DTCG JSON and its Style Dictionary 5.8.0 CSS, with matching revision and digests. Tokens support sRGB, px/rem, numbers and whole-token aliases in this slice. [Storage and supported profile](decisions/0002-project-commits.md#project-tokens) · [Preview authority](decisions/0003-preview-and-mcp.md)

On Apple Silicon macOS 27.0.1 (26A434), Node 24.16.0, pnpm 10.33.4 and Electron 45.3.2, all 15 checks in `EASY_PROTO_EVIDENCE="$PWD/evidence/project-tokens" pnpm verify` passed. The Electron check seeded an alias with the official MCP SDK, edited its target in the app, and observed `rgb(0, 0, 255)` change to `rgb(255, 0, 0)` on two pages. A 160 × 150 capture had the expected red pixel, matching token digests and an unchanged artboard source revision. Undo restored blue, then redo and reopen preserved red. Clipboard, add and delete, and import into a draft and committed exports were exercised. Automation supplies the native file picker paths. Both token tools refused a retired activation. Storage checks cover interrupted token saves on both sides of pointer publication, retry, stale edits, invalid tokens, and changed generated CSS on disk. [Verification log](../evidence/project-tokens/verify.log) · [Token manager](../evidence/project-tokens/token-manager.png) · [Capture evidence](../evidence/project-tokens/token-render.json)

The development app was reopened on EasyProtoMocks at revision 267. The token manager design is available as a mock artboard there. The verification tokens live in disposable projects. [Running app check](../evidence/project-tokens/live-app.json)

## Local agent chat review

Architecture and Reliability, Security, Infrastructure, and Frontend with Design independently reviewed the proposal. The review recommended starting with a dogfooded chat dock and one reviewable artboard edit. Codex and Claude authentication, runtime limits, and isolation remain provider qualification tasks. [Architecture review and release gates](chat-architecture.md)

## Desktop design system

EasyProtoMocks revision 270 contains 113 desktop design tokens created through the official MCP SDK. They cover neutral Light and Dark roles, typography, spacing, controls, radii, strokes, elevation, opacity and motion. A reproducible MCP sync exports the `desktop` group for the trusted shell, and the Vite build compiles it using the same Style Dictionary pipeline as project tokens. [Token catalog](../evidence/desktop-design-system/token-catalog.png) · [Workflow](design-guidance.md#desktop-tokens)

All 15 checks passed on Apple Silicon macOS 27.0.1 with Electron 45.3.2. Both themes use their expected chrome and canvas colors, bundled Inter, and shared toolbar and label sizing. The app kept those values when the open project supplied variables with matching names. The sync command reproduced the export byte for byte. The development app was reopened on the updated build with the catalog project active. [Verification log](../evidence/desktop-design-system/verify.log) · [Desktop readings](../evidence/desktop-design-system/desktop-stages.json) · [Running app](../evidence/desktop-design-system/live-app.json)

## Page rename and token editor refinements

The Pages picker shows a pencil beside each page. Enter saves the inline name and Escape cancels the edit. Renaming preserves page identity, order, and artboard membership. Undo and redo restore the corresponding name. Tokens opens with a 20 px window inset, a search icon, and an editor that replaces the selected table row. The type picker uses Chromium's customizable select for styling and keyboard interaction. Copy and save feedback use a reusable, dismissible toast.

All 16 checks passed on Apple Silicon macOS 27.0.1 with Electron 45.3.2. The desktop check covered cancel and focus restoration, rename undo and redo, reopening, the modal inset at 660 px and 1180 px window widths, filtering, inline focus, keyboard opening and closing of the styled type picker, clipboard content, and toast dismissal and timeout. The storage check covered the implicit default page, stale rename rejection, and retry after reopening. Electron was reopened on EasyProtoMocks revision 280. [Verification](../evidence/workspace-refinements/verify.log) · [Page rename](../evidence/workspace-refinements/page-rename.png) · [Inline type picker](../evidence/workspace-refinements/token-type-picker.png) · [Copy toast](../evidence/workspace-refinements/token-copy-toast.png)

## Compact Pages menu

The Pages picker uses a 192 px list with a leading checkmark and a rename pencil that appears on hover or keyboard focus. The pencil keeps a 24 px hit area. All 16 macOS checks passed. The Electron check demonstrated the reveal with pointer and keyboard input, page switching, and rename persistence and undo. EasyProtoMocks is running on the updated build at revision 281. [Dark](../evidence/compact-pages/pages-picker.png) · [Light with hover](../evidence/compact-pages/pages-picker-light-hover.png) · [Verification](../evidence/compact-pages/verify.log)

## Pages and Tokens review candidate

The unpublished candidate `aee823edd9f9c13a7e0dc957ff13d1b0f628cb46` freezes the batch and EasyProtoMocks revision 281 ahead of chat design work. The isolated archive passed a pinned offline install and all 16 macOS checks. The portable snapshot reopened and matched the bundled token export. Independent sign-off is pending. [Review handoff](../evidence/pages-tokens-review/review.md) · [Candidate bundle](../evidence/pages-tokens-review/candidate.bundle)

## Chat dock mock

The live EasyProtoMocks **Chat dock** page contains four artboards captured at revision 340. The composer stays pinned below the scrolling conversation. The interactive copy demonstrates the simulated attach, stream, Apply, Undo, Stop, Discard and stale-proposal states, plus the revised Home, footer Settings, and Chat controls. [Design handoff](dogfooding.md#chat-dock-walkthrough) · [Interactive mock](../evidence/chat-dock/chat-dock.html)

## Shared select

The token editor uses a reusable Select with a bordered field and a quiet toolbar variant. All 16 macOS checks passed in the Select iteration, including keyboard selection and Escape in the desktop field. [Design guidance](design-guidance.md#select-controls) · [Desktop checks](../evidence/shared-select/verify.log)

## Workspace and desktop chat

EasyProtoMocks groups the 19 artboards by flow. The identical settings copy is in Archive and the Eggs page remains available. At revision 332 the project check confirmed unchanged artboard identities, sizes, and source digests. Revision 340 updates the four Chat dock mocks. [Verified layout](../evidence/mock-project-organization/layout.json) · [Mock revisions](dogfooding.md#chat-dock-walkthrough)

In the desktop app, the Easy Proto header button returns Home, Settings sits at the bottom left, and Chat is visibly active while the drawer is open. The **Local demo** streams a response and proposes one headline change to an attached artboard. Apply commits to the existing project history, and Undo restores the original. Chat state is scoped to the current project activation for the session. The app reopened on EasyProtoMocks revision 340. [Desktop review state](../evidence/desktop-chat/desktop-chat-review.png) · [Running app check](../evidence/desktop-chat/live-app.json)

All 17 desktop and storage checks passed on Apple Silicon macOS with Electron 45.3.2. The working-tree Security consultation found a Stop timing race between streaming and proposal. The fix lets the current turn cancel in either phase, and the desktop check confirms Apply cannot commit afterward. The suite also covers project switching, stale artboard proposals, duplicate Apply, and Undo. The installed Codex build completed an isolated stdio initialization. Authenticated provider turns and packaged-app behavior are still open. [Desktop verification](../evidence/desktop-chat/verify.log) · [Chat architecture](chat-architecture.md)

## Logo workshop

**Fold**, **Stack**, and **Focus** each have Light and Dark SVGs. Chromium rendered all three at 16, 24, and 48 px in both themes. The design recommendation is Fold, whose clipped corner and inset step hold up at 16 px. The comparison is ready for selection. [Comparison](../evidence/logo-workshop/index.html) · [Verification](../evidence/logo-workshop/checks.json)

## Local browser sharing

Run `pnpm web:dev` and sign in as `owner@example.test` using the Local inbox. The TanStack prototype shares a synthetic canvas or one artboard with optional phone and laptop frames. Two Node and Chromium checks cover single-use same-browser sign-in, unchanged artboard viewport dimensions during browser zoom, preview isolation, one-board scope, and immediate revocation on the next request. [Demo and commands](../apps/web/README.md) · [Browser verification](../evidence/tanstack-web/verify.log)

Architecture and Security consulted on immutable exports, scoped preview access and signed-in publishers. The prototype uses in-memory state and synthetic email. The next web task is to connect one real desktop snapshot to the staged Workers, D1 and private R2 workflow. Production mail, optional passwords, and live published HTML/CSS require their own verification. [Sharing architecture](web-sharing-architecture.md)

## Shared UI and Codex experiment

The selected **Fold** mark is shared by the desktop and browser headers and their favicon assets. EasyProtoMocks revision 352 shows it in the four chat mockups. The workspace now keeps Electron in `apps/desktop/`, TanStack Router in `apps/web/`, and shared UI in `packages/ui/`. [Shared mark](../packages/ui/fold.svg) · [Mock capture](../evidence/chat-dock/chat-dock-attach.png)

The opt-in Codex adapter can propose a headline replacement in the desktop. The installed Codex binary and Electron passed the loopback fixture check for proposal, cancellation, Apply, and Undo. The development app continues to use Local demo unless it is launched with explicitly configured credentials. The next chat check is one live API-key turn in a disposable project, followed by review of the packaged launch. [Synthetic evidence](../evidence/codex-compatibility/turn.log) · [Setup and verification](chat-architecture.md#opt-in-codex-experiment)

## ChatGPT plan sign-in

The first ChatGPT plan sign-in used the chat drawer, the system browser, and the installed qualified Codex. The saved account was encrypted in the local app profile. The current agent setup moves those controls to Home. EasyProtoMocks revision 356 contains the entry-point mock. [Desktop entry point](../evidence/chatgpt-sign-in/before-sign-in.png) · [Integration decision](chat-architecture.md#sign-in-with-chatgpt)

All 22 automated checks passed on Apple Silicon macOS after a rerun of the existing canvas pan check. The ChatGPT fixtures verify callback binding and account identity, permit turns only with the plan grant, serialize token rotation and disconnect, and exercise the installed Codex request and edit approval. The live test used a disposable profile and a synthetic artboard. After the user approved ChatGPT plan usage, installed Codex returned the requested headline. The artboard stayed at revision 0 through review, Apply committed revision 1, and Undo restored the original headline at revision 2. The regular development app reopened on EasyProtoMocks revision 356. [Automated verification](../evidence/chatgpt-sign-in/verify.log) · [Live result](../evidence/chatgpt-sign-in/live-turn.json) · [Running app](../evidence/chatgpt-sign-in/live-desktop.json)

## Agent profiles mock

The **Agents** page in live EasyProtoMocks revision 367 contains eight screens for Home, provider setup, profile management, and selection in Chat. The offline interactive mock demonstrates multiple named Codex and Claude profiles, per-project selection, and reconnecting on Home. The composer places the upward-opening agent picker just before the icon-only paperclip. The preview uses synthetic auth and replies. [Dogfooding evidence](dogfooding.md#agents-on-home)

## Home agent profiles implementation

The desktop implements the approved EasyProtoMocks revision 367 flow. Home manages named Codex and Claude profiles. Codex uses ChatGPT browser sign-in, and Claude uses installed Claude Code with an Anthropic API key. Existing Codex sign-in migrates into the local encrypted profile store. Chat uses an upward-opening provider picker immediately left of the paperclip. **Manage agents** takes the user to Home. Project selection and per-agent display history stay scoped to the current app session. [Setup and verification commands](../readme.md#try-the-chat-drawer) · [Implementation decision](chat-architecture.md#home-agent-profiles)

All 26 checks passed on Apple Silicon macOS 27.0.1 with both native runtime fixtures enabled. The desktop fixture verified profile setup, rename, the renderer's Home-only configuration boundary, picker placement and grouping, and independent histories across profiles and copied projects. The settings fixtures verified migration failure recovery and independent credentials. Installed Codex 0.167.0-alpha.4.1 and Claude Code 2.1.325 used synthetic provider responses. Security was consulted on credential and project boundaries during implementation. Live provider sign-in and inference through the new Home flow remain to be exercised with user credentials. [Home screenshot](../evidence/agent-profiles/agents-home.png) · [Chat picker](../evidence/agent-profiles/chat-agent-picker.png) · [Verification log](../evidence/agent-profiles/verify.log)

The development app was restarted on EasyProtoMocks revision 367 and verified over MCP. The next bounded check is one live turn per provider through the new Home flow, followed by disconnecting one of two named profiles and confirming the other still works. [Running app check](../evidence/agent-profiles/live-desktop.json)

The agent picker now uses an inline name and caret. The focused macOS Electron check verified the borderless trigger, the menu above it, and profile selection. The updated app is running on EasyProtoMocks revision 369. [Desktop screenshot](../evidence/inline-agent-picker/chat-agent-picker.png) · [Verification log](../evidence/inline-agent-picker/verify.log)

The Git fixture is a compact copy of the revision 369 designs. The running EasyProtoMocks working copy retains its full history. The prior published checkpoint is recoverable from Git. [Fixture workflow](dogfooding.md)

## SQLite project pilot

The Pages, Tokens, Chat and local sharing baseline was reviewed, tested and pushed to GitHub as `57cad0b`. The Git checkout now contains 58 EasyProtoMocks files. Its complete working history is preserved in the ignored `mocks/.workspace/` copy. Two minor Frontend findings remain for the next accessibility pass. Announce chat proposal readiness, and focus the Tokens JSON editor when it opens. [Baseline verification](../evidence/sqlite-baseline/verify.log) · [Review dispositions](../evidence/sqlite-baseline/review.md)

The local SQLite pilot imports a copy of the active folder revision to a new editable `.easyproto` file. It preserves project and board identity, pages, source, tokens, assets and durable command receipts. A database write commits the document and receipt together. On macOS, **Open project** accepts both formats. Folder creation remains the default. [Commands](../readme.md#try-a-sqlite-project) · [Storage decision](decisions/0006-sqlite-project-pilot.md)

The local sample `mocks/.workspace/EasyProtoMocks.easyproto` imported revision 369 with 27 artboards, eight pages, 113 token rows and 369 receipts. The database is 606,208 bytes. The original current snapshot and pointer occupy 669,850 bytes, and the full working folder contains 83,625,298 bytes. Both EasyProtoMocks picker captures matched pixel for pixel across the two formats. The synthetic asset fixture also matched and reopened with the MCP edit saved. A process kill before SQLite commit preserved the prior state. A kill after commit preserved the new revision and returned the original receipt on retry. All 29 desktop and storage checks passed on Apple Silicon macOS. The updated app is running on the original EasyProtoMocks working folder at revision 369. [Sample comparison](../evidence/sqlite-pilot/easy-proto-mocks.json) · [Mock capture comparison](../evidence/sqlite-pilot/compare-mocks.json) · [Verification log](../evidence/sqlite-pilot/verify.log)

The next bounded task is a portable Save a Copy and export workflow, followed by opening both formats through packaged macOS and deciding when to make SQLite the default.

## Page deletion

The Pages picker reveals one Lucide settings icon on hover or keyboard focus. It opens a nested menu with Rename and Delete. Empty pages delete immediately. Populated pages ask for confirmation and state how many artboards will be removed. Cancel receives initial focus, and Escape returns focus to the picker. The final page's Delete control is disabled. Undo restores the page, its original position and default-page role, and every artboard's source, bounds and order in one step. The UI opens the restored page. Redo removes it again.

Both UI and the scoped MCP `delete_page` tool use the existing revision-checked command service. The implementation retains project tokens and assets, refuses stale confirmation, and replays the original receipt after reopen. Architecture and Reliability was consulted on page/default restoration and compatibility. [Storage decision](decisions/0002-project-commits.md#pages) · [Desktop confirmation](../evidence/page-deletion/page-delete-confirm-folder.png) · [Compact Dark menu](../evidence/page-deletion/pages-delete-menu-sqlite.png)

On Apple Silicon macOS 27.2.1, 33 checks passed and two optional provider-runtime checks were skipped. Implementer checks cover folder and SQLite projects, default and empty pages, the final-page restriction, cancellation, keyboard Undo/Redo, page source/order restoration, stale and mismatched command retries, MCP authority, save/reopen, and process termination before and after commit. The mock was updated through MCP at EasyProtoMocks revision 370 before the UI was implemented. The updated desktop was reopened on that working project and left running. [Verification](../evidence/page-deletion/verify.log) · [Mock capture](../evidence/page-deletion/mock.json)

An existing macOS text-field check now uses ArrowRight to collapse the selected title before Backspace. End did not move the selection on the current macOS build. The next bounded UI task remains the tracked accessibility follow-ups for chat status and the Tokens JSON editor.

The page row actions are now grouped under one settings icon. Its nested Rename/Delete menu supports keyboard opening, arrow navigation, Escape and focus return. The revised mock was captured at revision 371. Lint, formatting, TypeScript and build checks passed, along with the existing workspace flow and both folder/SQLite deletion flows. Electron was reopened on the updated working mock project. [Compact menu](../evidence/page-settings-menu/pages-delete-menu-sqlite.png) · [Focused verification](../evidence/page-settings-menu/verify.log)

## Arbitrary artboard size

The device size menu has an **Arbitrary size** option after the device groups. Choosing it reveals a bottom-right handle for that artboard. Dragging changes its iframe viewport live and releases one width/height command into the existing Undo history. The handle supports 5 px arrow-key steps and 20 px Shift-arrow steps. Choosing a device preset hides it. Its visibility is temporary editing state, and saved dimensions persist.

The handle converts pointer motion to viewport dimensions using the canvas zoom at the start of the gesture, then saves through the existing geometry command service. Geometry changes preserve the iframe and source revision. The handle clamps to the supported dimensions, keeps focus through keyboard saves, and rejects a gesture if another edit commits after it begins. Its hit area stays 24 CSS px across camera zoom. The design was captured through MCP at EasyProtoMocks revision 372. [Mock](../evidence/arbitrary-resize/mock.png) · [Desktop](../evidence/arbitrary-resize/arbitrary-resize.png)

The focused macOS checks passed for the new resize flow and the existing desktop/MCP slice. They measured the iframe viewport during and after a drag, one commit per gesture, Undo/Redo, a second drag at a different zoom, fixed handle hit area and corner alignment, keyboard increments, capture dimensions, a concurrent MCP edit, preset selection, and reopening. The updated app was left running on the current EasyProtoMocks working project. [Live app](../evidence/arbitrary-resize/live-app.json)

## SQLite, page settings, and resize release checks

The release checks cover SQLite payload limits, source integrity, refusal of unsupported recovery sidecars, rollback at capacity, and replacement of an active database. They also exercise focus return from page settings and successive keyboard resizes. The full run and review dispositions are recorded alongside the release evidence. [Verification](../evidence/sqlite-pages-resize-commit/verify.log) · [Review dispositions](../evidence/sqlite-pages-resize-commit/review.md)

## Save a Copy

The local desktop work builds on `5bd4d6b`. **Settings → Save a Copy…** writes an editable `.easyproto` file from an open folder or SQLite project. The original stays open. The file carries the saved revision, name, pages, sources, tokens, loaded assets, and command receipts. Copy creation preserves the existing file on a destination conflict. [Usage](../readme.md#save-a-portable-copy) · [Storage decision](decisions/0006-sqlite-project-pilot.md) · [Mockups](dogfooding.md#save-a-copy)

On Apple Silicon macOS 27.2.1, the focused Electron and MCP checks captured matching pixels for each source and its moved copy. Both copied projects reopened with the same tokens and assets, replayed an original receipt, rejected the source activation after switching, and preserved distinct edits to the original and copy. The checks also cover cancellation, occupied destinations, and an edit committed while the picker is open. The automated desktop checks supply the picker’s return value. A separate storage check verifies the queued snapshot, display name, and loaded asset bytes. [Verification](../evidence/save-a-copy/verify.log) · [Folder result](../evidence/save-a-copy/round-trip-folder.json) · [SQLite result](../evidence/save-a-copy/round-trip-sqlite.json)

The real macOS save sheet wrote EasyProtoMocks revision 376 with 29 artboards, seven pages, and 376 command receipts. The copy reopened after moving it, with the same snapshot and assets. The updated Electron app is open on the original EasyProtoMocks project. [Native check](../evidence/save-a-copy/native-copy.json)

The final `pnpm verify` run passed 43 tests. Two opt-in native agent runtime checks were skipped. An earlier run hit an intermittent resize test failure, and the next two full runs passed that check. [Final run](../evidence/save-a-copy/verify.log)

Architecture and Reliability consulted on pinning the snapshot and reusing the atomic SQLite writer. The next bounded portability check is reopening both project formats in a packaged macOS build.

## Direct ChatGPT login

Home has one **Log in with ChatGPT** button. It opens the system browser and assigns the profile name automatically. The desktop uses Codex and hides stored Claude profiles. Codex `0.169.0` passed the scoped Responses fixture and Electron Apply/Undo checks. Desktop coverage also exercises the browser handoff, cancellation, the unsupported-runtime message, and automatic chat selection of a connected profile. The mock was updated before implementation at EasyProtoMocks revision 378. [Design](dogfooding.md#agents-on-home) · [Verification](../evidence/chatgpt-login/verify.log)

## Project-wide chat

The working changes based on `f445934` enable open-project chat without an artboard selection. Codex can answer questions about the project and propose page and artboard commands. Existing source edits use a paperclip attachment. Each proposal uses the existing revision-checked Apply and Undo, and dependent changes use successive turns. Architecture and Security consultations informed the bounded provider context and single-command approval. [Architecture](chat-architecture.md#project-wide-chat) · [Design](dogfooding.md#chat-dock-walkthrough)

On Apple Silicon macOS 27.2.1 with Electron 45.3.2 and installed Codex 0.169.0, `EASY_PROTO_CHECK_CODEX_BIN="$(command -v codex)" pnpm verify` passed 44 checks and skipped the optional Claude executable check. The Codex fixture covered an unattached question, page create and rename, generated HTML/CSS, cross-page moves, attached content edits, stale and forged proposals, repeated Apply, cascade deletion and Undo. The fixture used a loopback Responses server. A separate live launch could not use the profile while the development service held it. The updated Electron service responded with EasyProtoMocks revision 380. The next verification is a live ChatGPT plan turn on a disposable profile using `pnpm desktop:verify:chatgpt-live`. [Verification](../evidence/project-chat/verify.log) · [Desktop proposal](../evidence/project-chat/desktop-chat-project-proposal.png)

Before the UI simplification, a live ChatGPT plan turn on `f445934` used a disposable project with Codex `0.167.0-alpha.4.1`. The proposal left revision 0 intact. Apply saved revision 1. Undo saved revision 2 and restored the exact original HTML/CSS. The temporary Codex profile was disconnected. The live check stopped before Claude connected when the user narrowed the scope. [Live results](../evidence/live-agent-setup/live-results.json)

## Chat composer

The composer has an agent picker and Send. Chat can edit existing HTML/CSS when the user names one artboard and Codex requests its source. Security consultation informed the one-board scope and the check against the current message and project revision. MCP captures at EasyProtoMocks revisions 381 and 382 informed the simplified composer. [Architecture](chat-architecture.md#project-wide-chat) · [Design](dogfooding.md#chat-dock-walkthrough)

The focused macOS Electron check used installed Codex 0.169.0 with a loopback Responses fixture. It edited a named artboard with the canvas selection cleared and rejected mismatched, partial, and ambiguous source targets. Page actions and a named cross-page move used project metadata. The check used zero OpenAI inference tokens. [Focused verification](../evidence/chat-composer/codex-fixture.log) · [Desktop composer](../evidence/chat-composer/desktop-chat-project-proposal.png)

The final `pnpm verify` run passed 44 checks and skipped the optional Claude runtime check. The development window is open on EasyProtoMocks with Chat visible. Live ChatGPT inference for source reads remains an opt-in check. [Full verification](../evidence/chat-composer/verify.log)

## Markdown replies

Chat renders Markdown in current and archived agent replies. The installed Codex fixture verified headings, list formatting, inline and fenced code, tables, and retention of Markdown in the next turn's context. The renderer discarded raw markup and displayed link and image labels as text. The test observed zero external resource requests and used zero OpenAI inference tokens. The design was tested through the revision 383 EasyProtoMocks capture and the Electron reply screenshot. [Architecture](chat-architecture.md#markdown-replies) · [Desktop reply](../evidence/chat-markdown/desktop-chat-markdown.png)

On Apple Silicon macOS 27.2.1, the full suite passed 44 checks and skipped the optional Claude runtime check. The rebuilt development service responded from Home. Native automation could not select the window after restart, so the disposable Electron run is the evidence for rendered replies. [Verification](../evidence/chat-markdown/verify.log)

The compact EasyProtoMocks fixture reopens at revision 373 with its original project identity and one saved snapshot. It packages the login and chat artboards alongside the existing mockups.

Release review prompted a one-time source approval inside Chat and cancellation of pending reads at the start of a project switch. The composer still has an agent picker and Send. The profile editor restores keyboard focus to the profile row, and move proposals show the displacement the canvas can save. [Project chat](chat-architecture.md#project-wide-chat)

The reviewed chat tree was pushed as `9e35614`. Frontend, Security, and Architecture/Reliability reviewed the same frozen tree. The remaining minor follow-up is to prevent quoted source in a reply from being echoed back to the same agent in later conversation context. The chat owner will revisit it before expanding source scope. [Review dispositions](../evidence/chat-release/dispositions.md)

## Monorepo layout

The workspace now keeps Electron in `apps/desktop/` and TanStack Router in `apps/web/`. The two apps import the shared UI, Fold mark, and Inter from `packages/ui/`. Desktop project persistence and IPC stay with the desktop app. The pinned pnpm workspace and Vite builds drive root commands for both apps.

On Apple Silicon macOS 27.2.1, both apps built after a frozen-lockfile install. Root verification in the disposable workspace passed 44 desktop checks and both web checks, with the optional Claude runtime check skipped. The installed Codex used a local fixture. Importing the compact mock via a repository-relative path produced an SQLite copy at revision 373. The development launcher points to `apps/desktop/` for the next opening and the existing window was left running with its open project. Review the monorepo move before its own commit. [Build log](../evidence/monorepo-layout/build.log) · [Verification](../evidence/monorepo-layout/verify.log)

## Local macOS install

The working tree based on `f2f7ca6` adds `./scripts/install-mac` to rebuild, check, replace, and reopen the personal Applications copy. The installed app retains its bundle identifier and Fold icon. On Apple Silicon macOS the candidate passed strict signature verification and the disposable Home check. The command then replaced the existing install, and the updated application showed Projects and Agents on Home. Lint and formatting passed. The next packaging check is a first install on a clean Mac account.

## External MCP only

The working tree based on `c96c2fc` removes built-in sign-in, provider runtimes, chat UI, and their IPC methods. Existing encrypted profile files are unused and preserved. Manual canvas controls and the authenticated local MCP contract continue to use the same document command service. The Mac installer packages the current renderer, main process, and preload.

On Apple Silicon macOS, external Codex CLI sessions created, updated, and captured a 320 × 240 artboard at revision 2 against both the development build and installed app. An independent SDK client checked the revision and capture, and Electron automation observed the edited heading. All 35 desktop and two web checks passed. This checkout required the desktop dependency directory on Node’s module search path for Playwright and a separately provisioned Chromium. Independent review is the next pre-commit step. [Installed external run](../evidence/mcp-only/installed-external.log) · [Canvas](../evidence/mcp-only/external-canvas.png) · [Suite](../evidence/mcp-only/test-results.log)

## Installed Mac app MCP startup

The working tree based on `2ce6da0` lets the installed Mac app start its authenticated loopback server from private per-user settings on a normal launch. Quitting the app released the port. Reopening the Applications copy and selecting the recent project let a fresh Codex session read its name and revision through `get_context`. All 36 desktop and two web checks passed. Independent review is the next step before commit.

## MCP page creation and batch visual review

The working tree based on `717cca8` implements the field report’s proposed first release. Agents can create and rename pages through the existing document commands, read the visible page from `get_context.activePageId`, and capture an ordered list of up to twelve artboards from one pinned revision. The result includes a labeled PNG sheet, per-board diagnostics, and an optional set of original PNGs.

A disposable macOS project exercised the workflow over the MCP SDK. It replayed a page create, renamed the page, placed ten variants on it, and verified the visible page after a canvas switch. One batch returned the requested order and identified the single variant with an unavailable Inter face. The regression check sampled pixels in every tile, checked an optional original’s dimensions, and rejected stale revisions, mismatched activation IDs, duplicate IDs, and a missing board. [Review sheet](../evidence/mcp-page-review/page-review.png)

All 37 desktop checks passed on the final build. The SQLite reopen check closed its window early on the first suite run, then passed in isolation and in the full rerun. Desktop type checking, build, lint, and formatting passed.

The next bounded task for the document service owner is to benchmark a revision-checked, undoable multi-artboard source update against the 44-board logo rollout. That write workflow and its recovery behavior remain unmeasured.

## Atomic 44-artboard logo rollout

The working tree based on `717cca8` adds `update_artboards`. One write returns one committed revision, all changed IDs, and their metadata. The existing command service checks the entire request before starting activity, publishes once, and records one canvas Undo entry. Retrying the original command returns its receipt after Undo or reopen.

The macOS replay used a disposable folder copy of the original Easy Fear & Greed project at revision 156. The approved HTML and CSS came from revision 200. With all 44 Mocks patches supplied in reverse document order, one MCP write took 441 ms and published revision 157. The saved sources matched the approved snapshot byte for byte on all 49 artboards. The five logo studies retained their original metadata and source revisions. Four batch capture calls returned all 44 previews with zero render warnings. Elapsed time from the write request through verified previews was 9.216 seconds in this local run, excluding fixture setup. [Review sheet from the first 12 boards](../evidence/mcp-batch-update/rollout-1.png)

A stale revision, a missing final target, and duplicate IDs left the saved manifest and scene version intact. A fresh stale write after the rollout also failed. One ⌘Z restored all original sources at revision 158 and left the studies untouched. The original project was used only for reading. The automated test normally builds a 44-target SQLite fixture; setting `EASY_PROTO_ROLLOUT_BEFORE` and `EASY_PROTO_ROLLOUT_AFTER` to matching before-and-approved project folders runs the historical replay on a private copy.

All 39 desktop checks passed, including a forced interruption before publication and a successful retry. Desktop build, type checking, lint, and formatting passed.

Next bounded task for the document service owner is to evaluate reusable SVG marks against this same rollout, including color inheritance in the smallest widget.

## Project artboard capacity

The working tree based on `717cca8` removes the fixed project artboard count from document creation and SQLite loading. Multi-selection commands and saved group receipts support selections larger than 50. The existing storage formats represent these projects. MCP accepts up to 50 updates or 12 captures per request.

The rebuilt Applications copy opened a disposable 49-board SQLite project and created three boards on a new page over MCP, reaching 52. Folder and SQLite regression checks reopened 52 boards, added board 53, moved 52 boards in a single command, undid the move, and reopened the saved receipt. All 29 project storage tests passed, along with desktop type checking, lint, and formatting. Performance at substantially larger project sizes is unmeasured. The desktop owner can benchmark opening and arranging larger pages as a separate task.

## Revision-guarded MCP Undo

The working tree based on `717cca8` exposes `undo` through MCP. Each request supplies its own command ID, the expected revision, and the original target command ID. The shared document queue matches the target to the next undoable edit before changing the document or history. Redo retains the edit’s original identity. Reopening clears the session history and preserves completed Undo receipts for exact retries.

In the installed app, two edits to a disposable project reached revision 2. Undo targeting the first edit returned `REVISION_CONFLICT` at the stale revision and `UNDO_CONFLICT` at the refreshed revision. Both reported revision 2. The full persisted snapshot matched before and after rejection. Undoing the two edits in order restored the original sources at revision 4. The desktop integration also checked the unchanged scene, missing guards, a 44-board batch after canvas Redo, and replay of a completed Undo after reopening.

The next bounded field-report task is to make long variant captions distinguishable on the ten-board mobile review sheet.

## Artboard context menu and selection footer

The working tree based on `717cca8` completes the existing partial context-menu implementation while preserving the pending MCP/document work. Right-clicking an unselected artboard selects it and offers Move to page, Rename, and Delete. Right-clicking within a selection keeps that selection and offers group Move/Delete. Multi-selection also exposes Move… and Delete in the footer. The former footer dropdown and Delete hint are removed. Menus use the existing desktop tokens, support Shift+F10, arrow navigation, Home/End, Escape, and outside dismissal, and clamp to the window. Page/project/revision changes dismiss the menu. Writes use the existing revision-checked, undoable document commands.

The design was updated through MCP and both single/group mockups were captured and inspected at EasyProtoMocks revision 375 with no unresolved dependencies. See [design notes](dogfooding.md#pages-picker-and-moving-artboards). Desktop build, type checking, lint, formatting, and whitespace checks passed using Node 24.16.0 and pnpm 10.33.4. All 30 document and local-settings checks passed. [Document checks](../evidence/artboard-context-menu/document-checks.log)

Runtime verification remains open for the desktop owner: the focused Electron integration check stops before launch because this session denies a loopback listener (`listen EPERM: operation not permitted 127.0.0.1`). Root `pnpm verify` also stops at the web tests for the same restriction. The added desktop checks cover single-board targeting, rename/cancel, single/group move and delete with Undo, keyboard focus, disabled Move on a single-page project, Light/Dark, window-edge placement, minimum size, and zoom; none of those new runtime assertions is represented as passed. The managed Node runtime was also unavailable (`Managed execution requires a usable CODEX_CLI_PATH`). [Focused attempt](../evidence/artboard-context-menu/focused.log) · [Root verification attempt](../evidence/artboard-context-menu/verify.log)

Next bounded task: run the updated desktop integration check in a local session that permits loopback listeners, inspect its Light/Dark captures, and rebuild the installed app after successful runtime verification. No commit or installed-app replacement was performed in this session.

## Desktop build directive warnings

The working tree based on `717cca8` filters only warning-level `MODULE_LEVEL_DIRECTIVE` messages about `"use client"` in the desktop Vite build. The renderer is entirely client-side, so these React Server Component markers do not affect it. Other diagnostics still reach the default handler.

Desktop build, type checking, and focused config lint/format checks passed with Node 24.22.3 and pnpm 10.33.4. The renderer asset hashes match the reported build. Vite still reports a separate future native-config-loader advisory about extensionless token imports; the desktop build owner can address that compatibility work separately. Existing pending runtime verification remains open as recorded above. No commit or installed-app replacement was performed.

## Fold loading concepts

On the working tree based on `717cca8`, the live EasyProtoMocks project now has **Loading · Fold studies** with five animated SVG concepts derived from the shared icon. The five-board MCP capture at project revision 386 was visually inspected with no render warnings or unresolved assets. Desktop accessibility confirmed the page selected and all five boards present. See [design notes](dogfooding.md#fold-loading-studies). The design owner should select a direction before motion tuning and production integration; animation timing and reduced-motion behavior remain untested. No desktop interface code or tracked mock checkpoint changed for these studies.

## Following MCP activity with Edge runner

The working tree based on `717cca8` follows newly presented MCP work to its page and frames its artboards. It replaces the old dots and iframe opacity pulse with Edge runner and Agent working over a theme-aware, softly blurred scrim. Presentation lasts at least 1.2 seconds without delaying writes or changing the tool's actual `working` result. Renewals do not recenter the canvas, manual page navigation can leave ongoing work, and active dragging/editing/menus take precedence. Group captures use one activity; new artboards present after publication. Timers clear on deletion, lease expiry, failed work, and project retirement. The chrome overlay does not modify preview source or capture output. [Design and token export](dogfooding.md#following-mcp-work)

Desktop type checking and build passed, alongside repository lint/format/whitespace checks. All 33 activity, document-storage, and local-MCP-settings checks passed, including minimum dwell, overlapping work, renewal without refocus, abandoned leases, failed work, deletion, and retirement. The dedicated Electron integration test was attempted but failed before launch at `listen EPERM: operation not permitted 127.0.0.1`; its UI assertions are not marked passed. The managed Node runtime was unavailable, and a separate offline browser attempt could not launch in this environment. [Integration attempt](../evidence/mcp-working-overlay/integration.log)

The desktop owner should next run `node --test verify/activity-follow.test.mjs` from `apps/desktop` in a local session with loopback access, then run the desktop suite and inspect Light/Dark, minimum size, camera motion, and reduced motion before replacing the installed app. No commit or installed-app replacement was performed.

On the subsequent local rebuild request, the renderer, main process, and preload built successfully again. `./scripts/install-mac` was attempted but could not create its lock file in the personal Applications directory (`Operation not permitted`). Its following "Another Easy Proto install is in progress" message does not establish an actual competing installer. The installed copy was not modified or restarted; the remaining install action is to run that script from a local terminal with access to Applications.

## Local page-to-web preview

The working tree based on `717cca8` adds a Cloudflare Worker and a page-only snapshot contract in `packages/preview`. The landing page collects normalized, deduplicated waitlist emails in local D1. A read-only PNG canvas at `/p/<id>` supports pan, zoom, fit, and artboard jumping. Settings opens a page export dialog with Sync, Open, Copy, and cancellation. Captures pin one revision; the Worker verifies PNG dimensions, sizes, and digests, stores R2 members, and publishes the stable page pointer in a D1 transaction. Old image URLs remain pinned. Local source and document history stay out of the upload. Existing pending desktop/MCP changes were preserved.

`pnpm local:setup` initialized real local D1 state through `cf`, and the Worker dev server is running at `http://127.0.0.1:8787`. Its registry was moved into the checkout and polling resolved restricted native watches. A live HTTP smoke check passed for the landing shell, waitlist, stable URL across two syncs, selected-page metadata, pinned R2 images, and authorization. Synthetic smoke rows and captures were removed afterward. Both apps and Worker/client type checks passed. All 37 desktop storage/activity/export/settings tests, five Worker tests, and the existing magic-link HTTP test passed. Repository lint, formatting, and whitespace checks passed. [Live check](../evidence/web-page-sync/local-http.json) · [Desktop checks](../evidence/web-page-sync/desktop-tests.log) · [Worker checks](../evidence/web-page-sync/worker-tests.log)

HTML studies for landing, viewer, and the desktop dialog are in `mocks/web-sync`. The Easy Proto MCP connection and browser access host were unavailable; visual inspection is not marked passed. `pnpm local:dev` built both components and reached a healthy Worker, but the development Electron process terminated with `SIGABRT`. The native dialog/capture-to-upload flow and Chromium viewer interaction checks remain open. The installed application was not replaced. The standalone web server is left running. The local launcher uses a separate desktop profile and a preserved working copy of the mock checkpoint, or accepts a repository-relative `--project` argument. [Setup](../apps/web/README.md)

Next bounded task for the desktop/web owner: launch `pnpm local:dev` in a native local terminal, inspect the three designs and sync an actual page twice through Settings, then verify the same URL in a browser. After that, scope hosted publisher identity/ownership and the production resource/deployment pipeline. No remote Cloudflare resources were created and no deployment or commit was performed.

Continuation closed a confirmed dev-server file-access gap: Vite could serve the private local publisher configuration through `/@fs`. The server now denies private configuration/state and local project files while preserving all exclusions in the pinned Vite defaults. The development capability was rotated in both ignored configuration files. A new disposable-fixture regression passed, and live requests to the private configuration, `.dev.vars`, and generated Cloudflare state/types returned 403. The running Worker accepted the rotated capability. [File-access evidence](../evidence/web-page-sync/private-file-access.json)

The new security check raises the focused passing check count to 44. The browser access host is still unavailable. The native retry initially could not resolve Electron from the monorepo; supplying the desktop dependency path through `NODE_PATH` resolved the executable, then failed before window creation with `Process failed to launch`. Native UI verification remained open at that point. [Native retry](../evidence/web-page-sync/native-retry.log)

A later unrestricted local run completed the missing native workflow. The combined launcher opened the development desktop on EasyProtoMocks revision 389 and served the Worker on loopback. Settings reviewed the **Home & settings** scope, synced its three artboards, and opened the generated page in Chrome. Syncing again retained the exact `/p/<id>` URL, and **Refresh preview** reloaded the same three-artboard revision. The dialog and viewer were inspected in Dark appearance. The focused `pnpm local:verify` run rebuilt the desktop and passed all six launcher/export checks. [Native UI check](../evidence/web-page-sync/native-ui.md)

The next bounded sharing task is to design hosted publisher identity and ownership around the now-verified local snapshot path, without changing the page export contract. Production resources, deployment, waitlist abuse controls, retention, and revocation remain out of scope for the local prototype.

User feedback replaced the local raster viewer with a schema-v2 live preview contract. One sync still contains exactly the selected page and retains its stable `/p/<id>` URL. Each artboard now uploads a sanitized document, board CSS, optional token CSS, and only assets observed while validating that board through the desktop preview host. The Worker rechecks sanitization, MIME, size, digest, board membership, and canonical asset paths before atomically publishing immutable members. The trusted canvas embeds each board with `sandbox=""`; response CSP blocks scripts, connections, forms, navigation, nested frames, and undeclared assets. Revision remains an internal stale-write guard but is absent from the dialog and public viewer.

The web header now mirrors the desktop sequence—brand, project, page—with the same 58 px height, 15 px/650 wordmark, 13 px/600 project and page names, dividers, padding, and vertical alignment. The artboard picker, refresh action, artboard count, and interaction hint were removed; the canvas keeps only the bottom-right zoom controls. No other pages are published or offered. Focused desktop/Worker checks passed for stable URLs, immutable old artifacts, HTML/CSS/assets, page-only public metadata, cancellation, stale publication, sanitization, traversal, and cross-board refusal. The native local workflow then synced EasyProtoMocks revision 389 and Chrome exposed three nested HTML documents with the expected headings and controls; the inspected viewer contained no revision label. Architecture/Reliability and Security were consulted before the boundary change. Hosted live preview remains blocked on the separate cookieless origin and production access work in the sharing architecture. The Easy Proto design MCP was unavailable, so the updated tracked studies still need an in-app capture review. `pnpm local:verify`, lint, formatting, and workspace type checks passed. The Worker and HTTP portion of `pnpm web:verify` passed; its legacy demo browser test stopped because the Playwright Chromium executable is not installed in this profile, while the native Chrome inspection covered the changed viewer.

The web React shell now consumes the same generated `desktop` token group as the Electron React renderer instead of maintaining a parallel surface palette. Native Chrome and Electron comparison confirmed matching dark background, canvas, border, foreground, and muted-foreground values while the live HTML artboards remained readable. Web type checking and production build passed after the token wiring. A Vite dependency optimization cache briefly left the dev page blank after the config hot reload; restarting `pnpm local:dev` restored the viewer, and a hard reload showed the three live artboards again.

Shared preview browser metadata now uses the shared Fold SVG as its favicon and `{projectName} - {pageName}` as its title. The Worker emits the page-specific title and initial page payload in the HTML response, while the React router maintains the title after client navigation. Native Chrome showed `EasyProtoMocks - Home & settings` with the Fold tab icon. Web type checking, production build, and all five Worker tests passed.

## Pre-commit verification for the desktop-to-web batch

The complete pending batch based on `717cca8` was frozen for review after closing the remaining test and local-permission gaps. Existing private local-web directories are normalized to mode `0700`, while settings and capability files are normalized to `0600`; a regression begins with deliberately permissive modes and verifies the correction. The web demo now shares the production desktop-token Vite plugin, and its security test loads the TypeScript Vite configuration through Vite rather than relying on Node's extension handling. Desktop integration assertions distinguish persisted document state from regenerated preview URLs, revision stamps, and expiring activity presentation.

Repository formatting, lint, type checks, production builds, Worker checks, local file-access checks, and browser demo verification pass. Root `pnpm verify` reports four root tests, six web Worker/security tests, two Playwright browser tests, and all 51 desktop tests passing with zero failures. The 44-artboard rollout separately completed in 9.9 seconds with one write, four capture batches, zero warnings, Undo, retry, and reopen. The Playwright Chromium runtime is installed for the local verification profile. The installed Applications copy was not replaced because this environment cannot write the personal Applications directory. Independent candidate review remains the final gate before commits.

## Shared workspace header and theme

The working tree based on `8461af2` generates one checked-in theme stylesheet from the EasyProtoMocks desktop token export. Both renderers consume it through `@easy-proto/ui/theme.css` and use the same WorkspaceHeader component. The desktop supplies editing and navigation controls. The published page supplies read-only project and page labels. The Frontend Lead owns shared UI and cross-app parity.

The checks compare a built desktop renderer and a published `/p/:id` page using the same header assertions for typography, alignment, spacing, foreground, surface and Inter loading. Electron and Chromium passed the regular and compact widths in Light and Dark. The web check uses the production client and Worker handler with disposable D1 and R2 adapters, and verifies a live HTML artboard. [Design check](dogfooding.md#shared-workspace-header)

Root `pnpm verify` passed all 64 tests. The next shared UI change should use these parity checks when promoting a primitive used by both apps.

## Web feature organization

The working tree based on `9bbb619` separates the landing page, shared viewer and legacy demo under `apps/web/src`. The standalone demo server and its boards live in `apps/web/demo`. The Worker keeps its entry point, route dispatch and error handling in `worker/index.ts`, with feature modules for waitlist signup, publishing, previews and artifacts, and the site shell. Routes, storage bindings, permissions and UI behavior are unchanged.

`pnpm web:verify` passed nine checks, including the published-page and legacy demo Chromium coverage. `pnpm local:verify` passed all seven launcher and desktop-to-Worker checks. Browser captures of the old and reorganized landing page were pixel-identical at 1180, 660 and 390 CSS px in Light and Dark. Lint, formatting, generated-theme validation and whitespace checks passed. The next organization pass can focus on the desktop renderer feature boundaries.

## Desktop renderer features and CSS Modules

The working tree based on `2bbea54` leaves the renderer entry point responsible for mounting React. The `workspace/` feature still coordinates desktop state, navigation and document commands. `canvas/` owns the React Flow adapter, artboard rendering, camera helpers, and board controls. The page picker and token editor live in `pages/` and `tokens/`, with reusable desktop controls under `shared/`.

Desktop component styles now use colocated CSS Modules. `base.css` contains theme and document-wide defaults. The canvas module targets React Flow's library classes explicitly. Integration tests use stable data attributes and accessible selectors for desktop elements.

In Electron, the 660px Dark workspace, page picker and token dialog matched the previous build pixel for pixel. At 1180px Light, the token dialog also matched exactly. The two canvas-containing captures differed only in fewer than 0.07% of pixels in the rendered artboard previews, by at most two color levels per channel. The first combined verification run passed all four root and nine web checks, plus 50 of 51 desktop tests. Its second arbitrary-resize drag timed out waiting for the saved revision. With no implementation changes, that test passed on its own and all 51 desktop tests passed on the standalone rerun. Lint, formatting, theme validation, type checking and builds passed.

## Desktop main process organization

The working tree based on `1fd4c6e` separates app startup and renderer IPC from the document command queue, folder and SQLite persistence, preview and capture, browser publishing, and local MCP transport. The serialized command body is unchanged apart from the extracted folder-storage call. IPC sender and project-generation guards, the startup order, preload bridge, and runtime bundle filenames are preserved.

All four root, nine web and 51 desktop checks passed in sequence, alongside lint, formatting, theme validation, type checks and builds. A separate Electron smoke run invoked the publishing bridge against a disposable local Worker fixture. It verified scope rejection, status, real capture and sync, published HTML for the selected page only, stable link lookup, and rejection after returning Home. No packaged install was performed.

## CSS Modules across application chrome

The web landing page, shared viewer, canvas and legacy demo now use CSS Modules, as do the shared Brand, Select and WorkspaceHeader. The remaining plain CSS under `apps/` and `packages/` holds base document rules, theme variables and font faces. Shared web canvas behavior and tests use stable data attributes, and the desktop picker test locates the native select by its accessible label.

The nine web checks passed, including the published route and the legacy demo in Chromium. Twelve before-and-after captures of the landing and shared viewer at 1180, 660 and 390 CSS px in Light and Dark matched pixel for pixel. Fifty desktop checks passed in the full run. The activity-follow test timed out and then passed in isolation on the same build. Lint, formatting, theme validation, type checks and builds passed.

## Shared package layout

The batch based on `21689e0` moves each shared UI component and its CSS Module into one folder. The theme, font, favicon and package exports retain their existing paths. `@easy-proto/preview` keeps one public entry point and separates schemas and limits, HTML sanitization, and digests into internal modules. The web client TypeScript configuration accepts the explicit TypeScript imports also used by native Node consumers.

Lint, formatting, theme validation and type checks passed. All six moved UI files were compared byte for byte. A differential Node check matched the preview runtime exports, limits, accepted and rejected schema results, sanitized output and SHA-256 results against the previous revision.

## Web UI mockups

The working EasyProtoMocks project now has a **Web UI** page with **Web Home** and **Shared Page**. The boards use the current web shell styles and shared Fold mark. The shared page uses sample artboards to show the read-only header and canvas; both boards are static HTML/CSS studies. The 1280 × 800 Dark captures at project revision 392 were inspected and reported no unresolved dependencies. The tracked mock checkpoint and production code were left intact.

Revision 394 updates **Web Home** to match the shared canvas header and adds **Web Home · Joined waitlist** with the disabled email field, confirmation button and success copy. Both 1280 × 800 Dark mockups were captured and inspected with no unresolved dependencies. The live home page now renders the shared `WorkspaceHeader`, with its existing tagline in the actions slot. Chromium verified matching home and published header height, gutter, typography and colors at 1180 and 660 px in Light and Dark. It also submitted the waitlist form through a disposable Worker fixture and checked the resulting joined state. All nine web checks and lint, formatting, theme and whitespace checks passed.

Revision 395 removes the home tagline and footer on both mockups and updates the description and signup hint. The joined state still confirms signup. Both 1280 × 800 Dark captures were inspected with no unresolved dependencies. The live landing page uses the same copy, and all nine web checks passed, including Chromium assertions for the shared header, the new copy and the joined state.

## Animated home mark

EasyProtoMocks revision 398 adds the desktop Edge runner to **Web Home** and **Web Home · Joined waitlist**. Revision 399 limits the home animation to two passes. Both 1280 × 800 Dark captures were inspected again with no unresolved dependencies. The web hero and desktop canvas activity overlay share the SVG and motion styles. Chromium checks the running highlight and its duration, a visible static mark with reduced motion, and the mark after signup. The focused Electron checks cover the desktop activity overlay.
