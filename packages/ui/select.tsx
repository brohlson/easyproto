import { ChevronDown } from "lucide-react";
import styles from "./select.module.css";

type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function Select<T extends string>({
  label,
  id,
  name,
  value,
  options,
  onValueChange,
  disabled,
  variant = "field",
  className,
}: {
  label: string;
  id?: string;
  name?: string;
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange(value: T): void;
  disabled?: boolean;
  variant?: "field" | "quiet";
  className?: string;
}) {
  return (
    <span
      className={className ? `${styles.field} ${className}` : styles.field}
      data-variant={variant}
    >
      <select
        className={styles.select}
        aria-label={label}
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const selected = event.currentTarget.value;
          const option = options.find((entry) => entry.value === selected);
          if (option && !option.disabled) onValueChange(option.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className={styles.chevron} aria-hidden="true" />
    </span>
  );
}
