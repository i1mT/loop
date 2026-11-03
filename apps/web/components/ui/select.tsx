"use client";
// 下拉选择。基于 Radix Select，不要再写原生 <select>。
import * as Select from "@radix-ui/react-select";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** 受控选择器。header 固定在选项列表最上面，用来放「新建」这类动作，它不是一个选项。 */
export function Picker({
  value,
  onChange,
  options,
  placeholder = "请选择",
  ariaLabel,
  className,
  header,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  header?: ReactNode;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Select.Root value={value || undefined} onValueChange={onChange}>
      <Select.Trigger
        aria-label={ariaLabel}
        className={clsx(
          "flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-control border border-line-strong bg-card px-2.5 text-left text-[13px] text-ink outline-none hover:border-ink-3 focus:border-ink focus-visible:outline-none",
          className,
        )}
      >
        <span className="min-w-0 truncate">{current ? current.label : <span className="text-ink-3">{placeholder}</span>}</span>
        <Select.Icon>
          <ChevronDown className="size-4 shrink-0 text-ink-2" aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={4} className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-control border border-line-strong bg-card p-1 shadow-lg outline-none focus-visible:outline-none">
          {header}
          <Select.Viewport>
            {options.map((o) => (
              <Select.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-[6px] px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-sunken"
              >
                <Select.ItemText>{o.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check className="size-4 text-ink-2" aria-hidden />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
