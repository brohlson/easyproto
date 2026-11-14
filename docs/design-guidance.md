# Easy Proto desktop design guidance

The desktop combines Geist’s neutral surfaces, crisp type hierarchy and deliberate borders with shadcn/ui’s semantic theme tokens. Easy Proto uses Inter for its interface, including compact controls and artboard labels. The bundled variable font lets the app use it offline. [Vercel Geist colors](https://vercel.com/geist/colors) · [Vercel Geist typography](https://vercel.com/geist/typography) · [shadcn/ui theming](https://ui.shadcn.com/docs/theming) · [Inter](https://rsms.me/inter/)

- Use white, black and neutral grays for the shell. Start with one background and use a slightly different surface for the canvas or a raised control. Reserve stronger contrast for active controls, focus and selection.
- Use one subtle border at a boundary, small consistent corner radii and restrained shadows on raised surfaces. Keep the canvas visually quiet so the artboards carry the color and detail.
- Use semantic CSS variables for surfaces, text, borders, hover and focus. Define equivalents for Light and Dark. System follows macOS appearance, and the toolbar lets users choose Light or Dark for the current app session. Keep the artboard’s authored presentation independent of the app’s appearance selection.
- Use Inter for chrome and tabular numerals for revisions and dimensions. Prefer concise action labels and let spacing, weight and alignment convey hierarchy.
- Provide visible keyboard focus, plain-language feedback, and a keyboard path for pointer controls. Expand small pointer targets to at least 24 CSS pixels. Check default, hover, active, selected, disabled and error states when the change affects them. [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines) · [shadcn/ui dark mode](https://ui.shadcn.com/docs/dark-mode)

For reviews, include the default and minimum window sizes, light and dark screenshots, and the keyboard sequence for the changed task. Inspect whether the design holds at different canvas zoom levels. If a control has a visual mark smaller than its active area, check the actual hit area in screen pixels.
