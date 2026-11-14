# Design in Easy Proto

Use [EasyProtoMocks](../mocks/EasyProtoMocks/) as the shared project for proposed Easy Proto screens. It opens from the desktop's **Open Project** picker like any other project.

1. Read the [desktop design guidance](design-guidance.md) and define the task the screen needs to support. Reuse the relevant artboard for revisions. Create a second board when comparing meaningful alternatives.
2. Open EasyProtoMocks and connect through the [local MCP workflow](../readme.md#connect-codex). Call `get_context` and confirm the open project before writing. Keep the HTML, CSS, and project assets portable. Use the canvas or MCP to save changes so revision checks and history are exercised.
3. Capture the committed artboard and inspect the image. For responsive changes, compare representative viewport sizes in the app. For desktop styling changes, inspect the relevant light and dark states. Record the artboard name, revision, viewport, and any tool friction in the design handoff. Static mockup controls depict proposed interactions. Verify those interactions separately in the implementation.
4. Carry the reviewed design into the product and run the relevant implementation checks. Keep the portable project in the repository. Put local screenshots and logs under the ignored `evidence/` directory and use repository-relative references in tracked files.

## Home and artboard activity

`Home` shows a Projects heading, a Create project action, and the empty state. `Home · Projects` replaces the empty message with a plain list. Both were captured at 960 × 600 at project revision 22. `Artboard · Agent working` shows the steady label, animated trailing dots, and opacity pulse on one board beside a second, idle board. It was updated with the Figma-inspired canvas colors through MCP and captured at 960 × 480 at project revision 56. The captures used dark appearance on macOS and reported no unresolved dependencies. The mockups also define light palettes. Home's controls are static. The label, dots, and pulse are implemented in the desktop.

The first capture reported that Inter could not load from the project’s local WOFF2 asset. The Home mockup uses the system fallback when Inter is unavailable. Reproduce the project-font failure with a disposable board, then verify the font loads in both the live preview and capture before switching this mockup to a bundled copy.

The Home boards now inform the desktop project launcher. The `Workspace · Edit and settings` artboard shows the inline title editor, fixed-size dimensions, and the Settings popover. All three were captured at 960 × 600 on macOS at project revision 59. See the [desktop evidence](../evidence/home-workspace/) for the implemented screens.

The same workspace artboard was updated through MCP at project revision 84 to compare the device-size popup and the settings rows. The 960 × 600 dark capture is under `evidence/dogfooding/Workspace-device-presets.png`. Real interaction and Lucide icons are in the desktop implementation.

`Workspace · Duplicate artboard` shows a selected copy offset from its original. It was captured in dark appearance at 760 × 540 at project revision 122. [Mockup capture](../evidence/dogfooding/Workspace-duplicate.png)

The same artboard depicts Copy, Paste, Undo, and Redo at project revision 129. [Mockup capture](../evidence/dogfooding/Workspace-copy-undo.png)

The Delete and Restore shortcuts were checked on the same artboard at project revision 174. [Mockup capture](../evidence/dogfooding/Workspace-delete.png)

Revision 183 uses the same artboard to preview a 180 ms fade on the copied board. [Mockup capture](../evidence/dogfooding/Workspace-preview-entry.png)

`Workspace · Multi-select` depicts dragging a selection box around two of three artboards. The local MCP capture of revision 224 rendered at 670 × 265 with no unresolved dependencies. The mockup depicts the gesture as a static frame. Electron automation exercises the live canvas separately. [Mockup capture](../evidence/dogfooding/Workspace-multi-select.png)

Revision 232 depicts a selection box crossing two artboards and a group outline aligned with their edges. The local MCP capture rendered at 670 × 265 with no unresolved dependencies. [Overlap mockup](../evidence/dogfooding/Workspace-multi-select-overlap.png)

Revision 252 previews the hint for scroll panning and pinch zoom. The local MCP capture rendered at 670 × 265 with no unresolved dependencies. The mockup shows the hint as text. Electron verifies the input behavior. [Trackpad mockup](../evidence/dogfooding/Workspace-trackpad-pan.png)

The repository copy saves the final artboard at revision 219, replayed through MCP on the previous checked-in mock project. [Portable mock capture](../evidence/multi-select-commit/portable-mock.png)
