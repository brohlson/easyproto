import { Check, ChevronDown, Monitor, Smartphone, Tablet } from "lucide-react";
import { useId, useRef, type KeyboardEvent } from "react";

type Size = { width: number; height: number };
type Preset = Size & { name: string };
type SaveSize = (size: Size) => void;

// Phone and tablet viewport dimensions from Chromium's EmulatedDevices.ts.
const groups: { name: string; icon: typeof Monitor; presets: Preset[] }[] = [
  {
    name: "Phone",
    icon: Smartphone,
    presets: [
      { name: "iPhone SE", width: 375, height: 667 },
      { name: "iPhone 16 Pro", width: 402, height: 874 },
      { name: "iPhone 16 Pro Max", width: 440, height: 956 },
      { name: "Pixel 9", width: 412, height: 924 },
    ],
  },
  {
    name: "Tablet",
    icon: Tablet,
    presets: [
      { name: "iPad mini", width: 768, height: 1024 },
      { name: "iPad mini landscape", width: 1024, height: 768 },
      { name: "iPad Pro 13", width: 1032, height: 1376 },
    ],
  },
  {
    name: "Desktop",
    icon: Monitor,
    presets: [
      { name: "Laptop", width: 1280, height: 800 },
      { name: "Desktop", width: 1440, height: 900 },
      { name: "Full HD", width: 1920, height: 1080 },
    ],
  },
];

export function DevicePresets({
  width,
  height,
  disabled,
  begin,
  arbitrary,
  onArbitraryChange,
}: Size & {
  disabled: boolean;
  begin: () => SaveSize | undefined;
  arbitrary: boolean;
  onArbitraryChange(value: boolean): void;
}) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const save = useRef<SaveSize | undefined>(undefined);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const options = Array.from(event.currentTarget.querySelectorAll("button"));
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const last = options.length - 1;
    if (event.key === "Home") options[0]?.focus();
    if (event.key === "End") options[last]?.focus();
    if (event.key === "ArrowDown") options[(index + 1) % options.length]?.focus();
    if (event.key === "ArrowUp") options[index <= 0 ? last : index - 1]?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="artboard-dimensions nodrag nopan"
        aria-disabled={disabled}
        aria-label={`Device size, ${width} × ${height}`}
        title="Choose device size"
        popoverTarget={id}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          if (!popover.current?.matches(":popover-open")) save.current = begin();
        }}
      >
        {width} × {height}
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      <div
        ref={popover}
        id={id}
        popover="auto"
        className="menu-panel preset-panel nodrag nopan nowheel"
        role="group"
        aria-label="Device sizes"
        onKeyDown={moveFocus}
        onToggle={(event) => {
          if (event.newState !== "open") return;
          const panel = event.currentTarget;
          (
            panel.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
            panel.querySelector("button")
          )?.focus();
        }}
      >
        {groups.map(({ name, icon: Icon, presets }) => (
          <div key={name} className="menu-section" role="group" aria-label={name}>
            <div className="menu-caption">
              <Icon aria-hidden="true" size={14} />
              {name}
            </div>
            {presets.map((preset) => {
              const current = !arbitrary && preset.width === width && preset.height === height;
              return (
                <button
                  key={preset.name}
                  type="button"
                  className="menu-row preset-row"
                  aria-pressed={current}
                  onClick={() => {
                    if (disabled) return;
                    popover.current?.hidePopover();
                    trigger.current?.focus({ preventScroll: true });
                    onArbitraryChange(false);
                    if (preset.width !== width || preset.height !== height)
                      save.current?.({ width: preset.width, height: preset.height });
                  }}
                >
                  <span>{preset.name}</span>
                  <span className="preset-size">
                    {preset.width} × {preset.height}
                  </span>
                  <Check aria-hidden="true" className={current ? "" : "inactive-check"} size={14} />
                </button>
              );
            })}
          </div>
        ))}
        <div className="menu-section">
          <button
            type="button"
            className="menu-row preset-row"
            aria-pressed={arbitrary}
            disabled={disabled}
            onClick={() => {
              popover.current?.hidePopover();
              trigger.current?.focus({ preventScroll: true });
              onArbitraryChange(true);
            }}
          >
            <span>Arbitrary size</span>
            <Check aria-hidden="true" className={arbitrary ? "" : "inactive-check"} size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
