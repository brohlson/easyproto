import assert from "node:assert/strict";

export async function checkWorkspaceHeader(page, { dark, compact }) {
  const header = await page.locator(".ep-workspace-header").evaluate(async (element) => {
    await document.fonts.ready;
    const style = getComputedStyle(element);
    const brand = element.querySelector(".ep-brand");
    const project = element.querySelector(".ep-workspace-project");
    const pageLabel = element.querySelector(".ep-workspace-page");
    const center = (node) => {
      const { top, height } = node.getBoundingClientRect();
      return top + height / 2;
    };
    return {
      height: style.height,
      gutter: style.paddingInlineStart,
      gap: style.columnGap,
      surface: style.backgroundColor,
      ink: style.color,
      brand: getComputedStyle(brand).fontSize,
      weight: getComputedStyle(brand).fontWeight,
      homeTarget: element
        .querySelector(".ep-workspace-brand > :is(a, button)")
        .getBoundingClientRect().height,
      labels: [project, pageLabel].map((node) => getComputedStyle(node.firstElementChild).fontSize),
      aligned: [brand, project, pageLabel].every(
        (node) => Math.abs(center(element) - center(node)) <= 1,
      ),
      font: [...document.fonts].some((font) => font.family === "Inter" && font.status === "loaded"),
    };
  });
  assert.deepEqual(header, {
    height: "58px",
    gutter: compact ? "12px" : "20px",
    gap: compact ? "8px" : "12px",
    surface: dark ? "rgb(44, 44, 44)" : "rgb(255, 255, 255)",
    ink: dark ? "rgb(245, 245, 245)" : "rgb(30, 30, 30)",
    brand: compact ? "14px" : "15px",
    weight: "650",
    homeTarget: 24,
    labels: ["13px", "13px"],
    aligned: true,
    font: true,
  });
}
