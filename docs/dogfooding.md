# Design in Easy Proto

The repository keeps one complete [EasyProtoMocks checkpoint](../mocks/EasyProtoMocks/) for proposed Easy Proto screens. Create a local working copy once, then reopen that copy in the desktop.

```sh
mkdir -p mocks/.workspace
test -e mocks/.workspace/EasyProtoMocks || cp -R mocks/EasyProtoMocks mocks/.workspace/
pnpm dev "--project=$PWD/mocks/.workspace/EasyProtoMocks"
```

1. Read the [desktop design guidance](design-guidance.md) and define the task the screen needs to support. Reuse the relevant artboard for revisions. Create a second board when comparing meaningful alternatives.
2. Open EasyProtoMocks and connect through the [local MCP workflow](../readme.md#connect-an-external-agent). Call `get_context` and confirm the open project before writing. Keep the HTML, CSS, and project assets portable. Use the canvas or MCP to save changes so revision checks and history are exercised.
3. Capture the committed artboard and inspect the image. For responsive changes, compare representative viewport sizes in the app. For desktop styling changes, inspect the relevant light and dark states. Record the artboard name, revision, viewport, and any tool friction in the design handoff. Static mockup controls depict proposed interactions. Verify those interactions separately in the implementation.
4. Carry the reviewed design into the product and run the relevant implementation checks. When updating the shared checkpoint, copy the working project's `project.json`, the single snapshot it names, the optional `.easy-proto/name.json`, and any `assets/` together. Replace the previous checked-in checkpoint as a set. Keep the working history under the ignored `mocks/.workspace/` directory. Put local screenshots and logs under `evidence/` and use repository-relative references in tracked files.

The current checkpoint copies the approved designs at revision 369 into a fresh project ID. Board and page IDs, source revisions, content and tokens carry over. Its command ledger starts empty. The local working copy retains all 369 receipts. The earlier published fixture with its own command history can be recovered with `git archive a33b9e4 mocks/EasyProtoMocks` and extracted in a separate directory. When publishing a checkpoint from a different lineage, create a new fixture project ID and an empty ledger.

## Home and artboard activity

`Home` shows a Projects heading, a Create project action, and the empty state. `Home · Projects` replaces the empty message with a plain list. Both were captured at 960 × 600 at project revision 22. `Artboard · Agent working` shows the steady label, animated trailing dots, and opacity pulse on one board beside a second, idle board. It was updated with the Figma-inspired canvas colors through MCP and captured at 960 × 480 at project revision 56. The captures used dark appearance on macOS and reported no unresolved dependencies. The mockups also define light palettes. Home's controls are static. The label, dots, and pulse are implemented in the desktop.

The first capture reported that Inter could not load from the project’s local WOFF2 asset. The Home mockup uses the system fallback when Inter is unavailable. Reproduce the project-font failure with a disposable board, then verify the font loads in both the live preview and capture before switching this mockup to a bundled copy.

The Home boards now inform the desktop project launcher. The `Workspace · Edit and settings` artboard shows the inline title editor, fixed-size dimensions, and the Settings popover. All three were captured at 960 × 600 on macOS at project revision 59. See the [desktop evidence](../evidence/home-workspace/) for the implemented screens.

The same workspace artboard was updated through MCP at project revision 84 to compare the device-size popup and the settings rows. The 960 × 600 dark capture is under `evidence/dogfooding/Workspace-device-presets.png`. Real interaction and Lucide icons are in the desktop implementation. Revision 372 adds the Arbitrary size option and a bottom-right handle in the same artboard. The 820 × 390 MCP capture reported no unresolved dependencies. [Arbitrary size mock](../evidence/arbitrary-resize/mock.png)

`Workspace · Duplicate artboard` shows a selected copy offset from its original. It was captured in dark appearance at 760 × 540 at project revision 122. [Mockup capture](../evidence/dogfooding/Workspace-duplicate.png)

The same artboard depicts Copy, Paste, Undo, and Redo at project revision 129. [Mockup capture](../evidence/dogfooding/Workspace-copy-undo.png)

The Delete and Restore shortcuts were checked on the same artboard at project revision 174. [Mockup capture](../evidence/dogfooding/Workspace-delete.png)

Revision 183 uses the same artboard to preview a 180 ms fade on the copied board. [Mockup capture](../evidence/dogfooding/Workspace-preview-entry.png)

`Workspace · Multi-select` depicts dragging a selection box around two of three artboards. The local MCP capture of revision 224 rendered at 670 × 265 with no unresolved dependencies. The mockup depicts the gesture as a static frame. Electron automation exercises the live canvas separately. [Mockup capture](../evidence/dogfooding/Workspace-multi-select.png)

Revision 232 depicts a selection box crossing two artboards and a group outline aligned with their edges. The local MCP capture rendered at 670 × 265 with no unresolved dependencies. [Overlap mockup](../evidence/dogfooding/Workspace-multi-select-overlap.png)

Revision 252 previews the hint for scroll panning and pinch zoom. The local MCP capture rendered at 670 × 265 with no unresolved dependencies. The mockup shows the hint as text. Electron verifies the input behavior. [Trackpad mockup](../evidence/dogfooding/Workspace-trackpad-pan.png)

The repository copy saves the final artboard at revision 219, replayed through MCP on the previous checked-in mock project. [Portable mock capture](../evidence/multi-select-commit/portable-mock.png)

## Pages picker and moving artboards

`Workspace · Artboard context menu` replaces the former full-size Move to page mockup. The MCP update at EasyProtoMocks revision 375 depicts Move to page, Rename, and Delete next to a single artboard, with its name and dimensions in the footer. `Workspace · Multi-select` at source revision 374 depicts the group menu and footer Move/Delete actions. Both were captured and inspected at project revision 375, at 1180 × 738 and 670 × 265 in Dark, with no unresolved dependencies. The changes live in the local SQLite working project. The tracked checkpoint remains at revision 373. The implementation's Light/Dark, minimum-size, keyboard, selection, and Undo checks are in the desktop integration test; this session could not execute them because loopback listeners are denied. No MCP capability was missing for the design checks.

EasyProtoMocks contains five artboards saved via MCP at source revisions 259–263. **Workspace · Pages picker** shows the current page and Add page. **Workspace · Move to page** shows the destination menu for two selected artboards. **Workspace · Page move confirmation** keeps the source page open and offers **Go to page**. The picker and destination menu have compact variants.

All five artboards were captured at project revision 263 in Light and Dark at content sizes 1180 × 738 and 660 × 448. The capture used a disposable copy of the committed snapshot and Chromium’s color-scheme emulation. All ten captures reported zero unresolved dependencies. The controls depict static states. The mock uses the system fallback when Inter is unavailable to the project. During implementation, verify keyboard navigation, Escape and focus return, then move two selected boards in one undo step. [Page picker](../evidence/pages-and-tokens/pages-picker-light.png) · [Move to page](../evidence/pages-and-tokens/move-to-page-compact-dark.png) · [Confirmation](../evidence/pages-and-tokens/page-move-confirmation-dark.png) · [Capture metadata](../evidence/pages-and-tokens/captures.json)

The companion fixture used Style Dictionary 5.8.0 and Node 24.16.0 to compile structured sRGB color, dimensions, one unitless number, and a whole-token alias from DTCG JSON. Missing references and cycles were rejected. Chromium resolved the alias to `rgb(51, 102, 204)`, the spacing to `12px` and `24px`, and the number to `0.75`. The stock formatter emitted the token description even with its file header disabled. The fixture removes descriptions from compiler input while preserving them in source and verifies that metadata-only edits leave the CSS bytes identical. [Fixture and output](../evidence/pages-and-tokens/style-dictionary/) · [Chromium results](../evidence/pages-and-tokens/style-dictionary/chromium-result.json)

## Project-wide token manager

`Workspace · Project tokens` shows the search field, token rows, resolved values, JSON action, and inline edit flow. It was saved using MCP and captured at 1040 × 620 in EasyProtoMocks revision 267 with no unresolved dependencies. The mockup depicts the interface in a static state. The live desktop check edits a shared alias target and looks at artboards on two different pages. [Mockup](../evidence/project-tokens/token-manager-mock.png) · [Desktop](../evidence/project-tokens/token-manager.png)

## Desktop design system

The **Design system · Desktop tokens** artboard documents Light and Dark surfaces, key semantic color roles and the type scale. The first capture preceded the application wiring. The final 860 × 465 capture at EasyProtoMocks revision 270 used the published 113-token dictionary and reported no unresolved dependencies. The catalog uses its font stack on the preview host. The desktop itself verifies the bundled Inter file. [Catalog](../evidence/desktop-design-system/token-catalog.png) · [Capture metadata](../evidence/desktop-design-system/token-catalog.json)

## Page rename and inline token editing

The existing **Workspace · Pages picker** and **Workspace · Project tokens** artboards were updated through the MCP connection and captured at EasyProtoMocks revisions 279 and 280 respectively. The 1040 × 600 captures show the page pencil and inline rename field, wider Tokens dialog, in-row editor, type picker and copy toast. The captures reported no unresolved dependencies. [Page rename mock](../evidence/workspace-refinements/page-rename-mock.png) · [Tokens mock](../evidence/workspace-refinements/inline-token-edit-mock.png)

## Compact Pages menu

The existing **Workspace · Pages picker** artboard was updated through MCP at EasyProtoMocks revision 281 and captured at 820 × 310. It shows the compact list in Dark at rest and in Light with a row hovered. The rendition uses a leading check for the current page and reveals the rename control on hover. [Mockup](../evidence/compact-pages/compact-pages-mock.png)

## Chat dock walkthrough

EasyProtoMocks has a **Chat dock** page with four screens for attaching a selected artboard, reviewing a proposal, applying and undoing an edit, and handling a stale proposal in the compact layout. The MCP captures at revision 340 show bottom-left Settings, the Easy Proto Home button, and the active Chat button at 1180 × 738 and 660 × 448. Each reported zero unresolved dependencies. [Review state](../evidence/chat-dock/chat-dock-review.png) · [Compact conflict](../evidence/chat-dock/chat-dock-compact.png) · [Capture metadata](../evidence/chat-dock/captures.json)

Open the [clickable browser mock](../evidence/chat-dock/chat-dock.html) and choose **Attach Field notes**, **Send**, **Apply edit**, then **Undo**. Stop during the simulated stream or choose Discard in review to leave the demo artboard at its original headline. **Simulate newer edit** shows the conflict state. The composer stays at the bottom through each simulated state while the conversation and proposal scroll above. The prototype uses a fixed sample proposal and keeps interaction state in its browser tab. The EasyProtoMocks artboards show the static states. [Interaction checks](../evidence/chat-dock/interaction-check.json)

Revision 344 adds more composer padding and a 10 px gap above the action row. All four artboards were recaptured through MCP. The focused desktop check measured the gap, the visible keyboard focus ring, and the pinned composer in a 660 × 480 Dark window and a 1180 × 738 Light window. The chat workflow check passed on Apple Silicon macOS. [Compact Dark](../evidence/chat-composer-spacing/dark.png) · [Measurements](../evidence/chat-composer-spacing/geometry.json) · [Workflow check](../evidence/chat-composer-spacing/verify.log)

Revision 352 previews the selected **Fold** mark in the chat mock's Light and Dark header. All four artboards were recaptured through MCP. The desktop and web headers use the shared vector. [Mock capture](../evidence/chat-dock/chat-dock-attach.png) · [Shared asset](../packages/ui/fold.svg)

Revision 356 adds the **Continue with ChatGPT** entry point in the Attach mock. The app uses the published OpenAI mark and keeps the ChatGPT plan label and usage link near the composer after connecting. [Sign-in mock](../evidence/chat-dock/chat-dock-attach.png) · [Desktop before sign-in](../evidence/chatgpt-sign-in/before-sign-in.png)

The working EasyProtoMocks **Chat dock** page now has **Project chat** and **Project proposal** boards. The composer shows an enabled Send for an unattached page request. The second board shows the proposed page creation and Apply or Discard. The boards were updated through MCP and inspected at revisions 379 and 380. Both 1180 × 738 captures reported zero unresolved dependencies. [Composer](../evidence/project-chat/mock-compose.png) · [Proposal](../evidence/project-chat/mock-proposal.png) · [Desktop proposal](../evidence/project-chat/desktop-chat-project-proposal.png)

Revisions 381 and 382 simplify those two composers to the agent picker and Send. Both captures were made through MCP and inspected before implementation, with zero unresolved dependencies. [Composer](../evidence/chat-composer/mock-1.png) · [Proposal](../evidence/chat-composer/mock-2.png)

Revision 383 shows a formatted agent reply on **Chat dock · 2 Project proposal**. The dark mock uses a short heading, list, and inline code above the project proposal. The 1180 × 738 MCP capture had zero unresolved dependencies and was inspected before implementation. [Mock](../evidence/chat-markdown/mock.png) · [Desktop reply](../evidence/chat-markdown/desktop-chat-markdown.png)

## Page deletion

The **Workspace · Pages picker** artboard previews page deletion at revision 370. A compact trash action sits beside Rename. A populated page opens a confirmation with the artboard count and the Undo shortcut. The 820 × 310 MCP capture reported no unresolved dependencies. [Deletion mock](../evidence/page-deletion/mock.png)

Revision 371 replaces the two row actions with one settings icon and a nested Rename/Delete menu. The 500 × 220 MCP capture was inspected before implementation and reported zero unresolved dependencies. [Settings menu mock](../evidence/page-deletion/menu-mock.png)

## Save a Copy

The **Home & settings** page has two new boards beside the existing workspace mockup. **Workspace · Save a Copy** shows the focused Settings action in Dark. **Workspace · Project copy saved** shows the success toast above the footer in Light. Both were created and captured through MCP before implementation at EasyProtoMocks revisions 375 and 376. The captures are 660 × 448 and report zero unresolved dependencies. The native save sheet belongs to the desktop workflow. [Settings mockup](../evidence/save-a-copy/mock-settings-dark.png) · [Success mockup](../evidence/save-a-copy/mock-success-light.png) · [Capture metadata](../evidence/save-a-copy/mock-captures.json)

## Agents on Home

The **Agents** page in EasyProtoMocks shows the proposed Home layout, provider choice, Codex and Claude setup, editing an existing profile, and the chat agent picker. Home keeps Projects and Agents as two plain lists with their own empty states. Codex setup uses **Continue with ChatGPT** and Claude setup shows an Anthropic API key. Both happen from Home. [Home](../evidence/agent-setup/home.png) · [Add agent](../evidence/agent-setup/add-agent.png) · [Codex](../evidence/agent-setup/codex.png) · [Claude](../evidence/agent-setup/claude.png) · [OpenAI account guidance](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) · [Anthropic authentication guidance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)

The chat picker sits immediately left of the icon-only paperclip in the composer and opens upward. It groups profiles by provider and shows which one is active. Profiles that need reconnection remain visible and unavailable to select. **Manage agents** returns to Home and focuses Agents. The prototype remembers the selection per project and retains a separate demo conversation for each agent. [Picker](../evidence/agent-setup/picker.png) · [Empty picker](../evidence/agent-setup/chat-empty.png)

All eight MCP captures at revision 367 reported zero unresolved dependencies. Chromium on Apple Silicon macOS verified adding profiles of both types alongside the seeded profiles, editing and reconnecting, keyboard selection and focus return, separate conversations, the new composer order, and the compact empty state. The paperclip keeps its accessible name and shows a pressed state when attached. The clickable mock uses synthetic connections and sent zero external requests. Add page required the desktop page picker. [Capture metadata](../evidence/agent-setup/captures.json) · [Interactive mock](../evidence/agent-setup/agent-setup.html) · [Browser checks](../evidence/agent-setup/interaction-check.json)

Revision 369 updates the populated and empty chat mockups with an inline name and caret. Both were recaptured and inspected before applying the change to the desktop. [Dark picker](../evidence/agent-setup/picker.png) · [Light empty picker](../evidence/agent-setup/chat-empty.png)

The **Agents · Log in with ChatGPT** board updates the existing sign-in artboard at revision 378. Home shows one login action under Agents, with the project list kept separate. The 1180 × 738 dark capture was inspected before implementation and reported zero unresolved dependencies. [Login mock](../evidence/chatgpt-login/mock-home-login.png)

## Shared select

**Design system · Select** shows the toolbar and form variants in Light and Dark. It was created via MCP and captured at EasyProtoMocks revision 296. The desktop token editor uses the shared Select for token type. The appearance choices now appear directly in the footer Settings menu in both the interactive chat mock and the desktop. Chromium verified Light and Dark switching, Escape, Home and return to the project, and the pinned composer at both mock widths. [Design artboard](../evidence/shared-select/design.png) · [Interaction checks](../evidence/chat-dock/interaction-check.json)

## EasyProtoMocks organization

The mock project now groups its screens under **Home & settings**, **Canvas**, **Pages**, **Design system**, and **Chat dock**. **Archive** contains the identical settings copy. **Eggs** is available as a separate page. The project layout was verified at revision 332 using its live MCP state. All 19 original artboards retained their names, viewports, and source digests. [Page and layout evidence](../evidence/mock-project-organization/layout.json)

## Projects-only Home

For the external-MCP-only desktop, the existing Home artboard in a working copy of EasyProtoMocks was updated through MCP and captured as **Home · Project launcher**, revision 374 at 1180 × 738. It shows project creation, recent projects, and Settings. The desktop check also exercises the empty state. The design client supplied the desktop workspace’s Electron executable explicitly because this checkout’s Playwright installation could not resolve it automatically. [Design capture](../evidence/mcp-only/home-design.png) · [Empty Home](../evidence/mcp-only/home-empty.png)

## Fold loading studies

The **Loading · Fold studies** page was created through MCP in the live EasyProtoMocks project at revision 381. Its five 640 × 520 artboards, committed at revisions 382–386, compare **Contour chase**, **Quiet pulse**, **Corner fold**, **Step assembly**, and **Edge runner**. Each derives from the shared Fold vector, uses existing desktop color tokens, and shows Light/Dark plus 16, 24, and 32 px examples. SVG geometry and CSS animate without scripts; a reduced-motion rule supplies static marks.

The ordered MCP review sheet at revision 386 was captured and visually inspected with zero unresolved dependencies. The running desktop showed the new page selected with all five boards. The captures establish rendering, not frame-by-frame motion or a tested reduced-motion preference. No MCP capability was missing. The live working project contains the studies; the tracked checkpoint was not replaced. Next task: choose a direction before tuning timing or integrating it into the desktop.

## Following MCP work

The selected **Edge runner** concept now informs **Artboard · Follow MCP work**, the reused agent-activity artboard on **Canvas**. The MCP capture at revision 388, 1032 × 680, was visually inspected before implementation and reported no unresolved dependencies. It compares Light and Dark scrims over the same artboard, the centered 48 px mark and Agent working label, page following, and a minimum 1.2-second display before revealing the edit. The desktop token group was authored through MCP, including scrim colors, indicator motion, and focus/dwell durations; its final revision is 389.

`pnpm tokens:sync` could not connect to the running app because this session denies loopback connections. The committed group was instead read through `get_tokens` and exported to the same build input. This was transport friction, not a missing MCP capability. The renderer and document-service behavior checks are recorded in the handoff; production Light/Dark, small-viewport, camera-following, and reduced-motion checks remain pending in an Electron session that permits loopback listeners.
