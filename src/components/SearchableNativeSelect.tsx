import React from "react";
import { SearchableSelect, type SearchableOption } from "@/components/SearchableSelect";

// A drop-in, searchable replacement for a native <select> whose list grows
// with the business (bookings, leads, users, suppliers...). It takes the same
// props and the same <option> children as <select>, and calls onChange with a
// select-shaped event ({ target: { value } }), so a screen switches by changing
// the tag only and keeps its handlers as they are. Rendering goes through
// SearchableSelect, which is safe inside dialogs.

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> & {
  value?: string | number | readonly string[] | null;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  searchPlaceholder?: string;
};

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

function collect(children: React.ReactNode, out: SearchableOption[], group = "") {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean; label?: string };
    if (child.type === "option") {
      const label = textOf(props.children).replace(/\s+/g, " ").trim();
      out.push({
        value: props.value != null ? String(props.value) : label,
        label: group ? `${group} · ${label}` : label,
        disabled: !!props.disabled,
      });
    } else if (child.type === "optgroup") {
      collect(props.children, out, props.label ?? group);
    } else {
      // Fragments and other wrappers: walk their children.
      collect(props.children, out, group);
    }
  });
}

export function SearchableNativeSelect({ value, onChange, children, disabled, className, name, searchPlaceholder }: Props) {
  const options: SearchableOption[] = [];
  collect(children, options);
  const current = value == null ? "" : String(value);
  const empty = options.find((o) => o.value === "");
  return (
    <SearchableSelect
      options={options}
      value={current}
      disabled={disabled}
      className={className}
      placeholder={empty?.label || "Select..."}
      searchPlaceholder={searchPlaceholder ?? "Type to search..."}
      onChange={(next) => {
        const target = { value: next, name: name ?? "" } as unknown as HTMLSelectElement;
        onChange?.({ target, currentTarget: target } as React.ChangeEvent<HTMLSelectElement>);
      }}
    />
  );
}
