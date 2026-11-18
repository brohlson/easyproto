export function startCamera(viewport: HTMLElement, controls: HTMLElement) {
  const controller = new AbortController();
  const listeners = { signal: controller.signal };
  const camera = viewport.querySelector<HTMLElement>(".camera")!;
  const cards = [...camera.querySelectorAll<HTMLElement>("figure")];
  const single = viewport.dataset.scope !== "canvas";
  for (const card of cards) {
    card.style.left = `${single ? 0 : Number(card.dataset.x)}px`;
    card.style.top = `${single ? 0 : Number(card.dataset.y)}px`;
  }

  let zoom = 1;
  let x = 0;
  let y = 0;
  let drag: { id: number; x: number; y: number } | undefined;
  let manuallyMoved = false;
  function render() {
    camera.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
  }

  function fit() {
    const width = Math.max(...cards.map((card) => card.offsetLeft + card.offsetWidth));
    const height = Math.max(...cards.map((card) => card.offsetTop + card.offsetHeight));
    const inset = viewport.clientWidth < 600 ? 32 : 112;
    zoom = Math.min(
      1,
      (viewport.clientWidth - inset) / width,
      (viewport.clientHeight - 90) / height,
    );
    zoom = Math.max(0.1, zoom);
    x = (viewport.clientWidth - zoom * width) / 2;
    y = (viewport.clientHeight - zoom * height) / 2;
    manuallyMoved = false;
    render();
  }

  function changeZoom(
    factor: number,
    anchorX = viewport.clientWidth / 2,
    anchorY = viewport.clientHeight / 2,
  ) {
    const next = Math.min(2, Math.max(0.1, zoom * factor));
    x = anchorX - ((anchorX - x) * next) / zoom;
    y = anchorY - ((anchorY - y) * next) / zoom;
    zoom = next;
    manuallyMoved = true;
    render();
  }

  controls.querySelector('[data-zoom="fit"]')!.addEventListener("click", fit, listeners);
  controls
    .querySelector('[data-zoom="out"]')!
    .addEventListener("click", () => changeZoom(1 / 1.2), listeners);
  controls
    .querySelector('[data-zoom="in"]')!
    .addEventListener("click", () => changeZoom(1.2), listeners);
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        changeZoom(
          Math.exp(-event.deltaY * 0.01),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      } else {
        x -= event.deltaX;
        y -= event.deltaY;
        manuallyMoved = true;
        render();
      }
    },
    { ...listeners, passive: false },
  );
  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || drag) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      viewport.dataset.moving = "";
      viewport.setPointerCapture(event.pointerId);
    },
    listeners,
  );
  viewport.addEventListener(
    "pointermove",
    (event) => {
      if (drag?.id !== event.pointerId) return;
      x += event.clientX - drag.x;
      y += event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      manuallyMoved = true;
      render();
    },
    listeners,
  );
  viewport.addEventListener(
    "lostpointercapture",
    (event) => {
      if (drag?.id !== event.pointerId) return;
      drag = undefined;
      delete viewport.dataset.moving;
    },
    listeners,
  );
  window.addEventListener(
    "resize",
    () => {
      if (!manuallyMoved) fit();
    },
    listeners,
  );
  fit();
  return () => controller.abort();
}
