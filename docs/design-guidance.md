# Easy Proto desktop design guidance

The desktop uses Figma-inspired neutral surfaces, Geist’s crisp type hierarchy and deliberate borders, and shadcn/ui’s semantic theme tokens. Easy Proto uses Inter for its interface, including compact controls and artboard labels. The bundled variable font lets the app use it offline. [Figma themes](https://help.figma.com/hc/en-us/articles/5576781786647-Change-themes-in-Figma) · [Figma semantic colors](https://developers.figma.com/docs/plugins/css-variables/) · [Vercel Geist typography](https://vercel.com/geist/typography) · [shadcn/ui theming](https://ui.shadcn.com/docs/theming) · [Inter](https://rsms.me/inter/)

- Use white chrome and a `#f5f5f5` canvas in Light. Use charcoal `#2c2c2c` chrome and a `#1e1e1e` canvas in Dark. Reserve stronger contrast for active controls, focus and selection.
- Use one subtle border at a boundary, small consistent corner radii and restrained shadows on raised surfaces. Keep the canvas visually quiet so the artboards carry the color and detail.
- Use semantic CSS variables for surfaces, text, borders, hover and focus. Define equivalents for Light and Dark. System follows macOS appearance, and the toolbar lets users choose Light or Dark for the current app session. Keep the artboard’s authored presentation independent of the app’s appearance selection.
- Use Inter for chrome and tabular numerals for revisions and dimensions. Prefer concise action labels and let spacing, weight and alignment convey hierarchy.
- Provide visible keyboard focus, plain-language feedback, and a keyboard path for pointer controls. Expand small pointer targets to at least 24 CSS pixels. Check default, hover, active, selected, disabled and error states when the change affects them. [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) · [shadcn/ui dark mode](https://ui.shadcn.com/docs/dark-mode)

For reviews, include the default and minimum window sizes, light and dark screenshots, and the keyboard sequence for the changed task. Inspect whether the design holds at different canvas zoom levels. If a control has a visual mark smaller than its active area, check the actual hit area in screen pixels.

## Desktop tokens

Maintain the `desktop` group in EasyProtoMocks through `get_tokens` and `replace_project_tokens`. Keep both theme groups complete. Reference semantic roles such as `desktop.light.background` in consumers and let them alias the neutral palette. Use the shared typography, spacing, shape, opacity and motion scales for new desktop controls. Keep independent artboard presentation and component-specific geometry in their own styles.

With EasyProtoMocks open and the local MCP connection configured, run `pnpm tokens:sync` to export the committed desktop group and generate the shared stylesheet with Style Dictionary. Both app builds consume `@easy-proto/ui/theme.css`, which imports the generated variables, semantic theme and Inter. Commit the generated `packages/ui/theme.tokens.css` alongside its JSON input. `pnpm theme:build` regenerates it from the saved export. Use `pnpm desktop:build` or `pnpm web:build` to validate freshness and token references before bundling. The Mac installer uses the checked desktop build. Project tokens continue to affect project previews independently of the app theme.

The **Design system · Desktop tokens** artboard in EasyProtoMocks previews both theme palettes and common controls. Check that artboard before syncing changes to the app. Inspect the app itself to verify the bundled Inter font and keyboard focus treatment.

## Select controls

Use the shared [Select component](../packages/ui/select.tsx) for single-choice fields. The default field has a subtle border. Use the quiet variant for a compact toolbar control. Both variants share option spacing, a trailing checkmark and the focus ring. They keep the browser's keyboard behavior. [Chromium customizable select](https://developer.chrome.com/blog/a-customizable-select)

Use colocated CSS Modules for component styles in both renderers and the shared UI package. Keep theme variables, font faces and document-wide defaults in global stylesheets. Use accessible roles or stable data attributes for tests and DOM hooks.

## Fold mark

Use the shared [Brand component](../packages/ui/brand.tsx) in application headers. Fold uses the foreground color in both themes and pairs with the Easy Proto wordmark. The clipped corner and inset step come from the Easy Proto logo workshop. Use the same [Fold vector](../packages/ui/fold.svg) for the favicon.

Use the shared [WorkspaceHeader](../packages/ui/workspace-header.tsx) for the desktop workspace and published page. Desktop supplies its Home button, editable project name, page picker and Tokens action. The published page supplies a Home link and read-only names for its single page. Check the shared layout at regular and compact widths in both themes.
