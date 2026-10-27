import type { ComponentProps, ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "../../lib/utils";

const tones = {
  muted: { label: "text-sidebar-muted-foreground/60", line: "bg-sidebar-border/60" },
  info: { label: "text-info", line: "bg-info/20" },
  plum: { label: "text-plum", line: "bg-plum/20" },
  emphasized: { label: "text-sidebar-foreground/80", line: "bg-sidebar-foreground/25" },
  accent: { label: "text-primary", line: "bg-primary/50" },
} as const;

export function CollapsibleSectionHeader({
  children,
  expanded,
  tone = "muted",
  variant = "default",
  accessory,
  action,
  actionOpen = false,
  ...buttonProps
}: Omit<ComponentProps<"button">, "className" | "style" | "aria-expanded"> & {
  expanded: boolean;
  tone?: keyof typeof tones;
  variant?: "default" | "panel" | "sidebar";
  accessory?: ReactNode;
  action?: ReactNode;
  actionOpen?: boolean;
}) {
  const button = (
    <button
      {...buttonProps}
      type="button"
      aria-expanded={expanded}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        variant === "panel" ? "ps-2 pe-2.5" : "px-2",
        tones[tone].label,
      )}
    >
      <span className={variant === "sidebar" ? "min-w-0 truncate" : "shrink-0"}>{children}</span>
      {variant !== "sidebar" ? (
        <span aria-hidden className={cn("h-px min-w-2 flex-1", tones[tone].line)} />
      ) : null}
      {accessory}
      {variant !== "sidebar" ? (
        <ChevronDownIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", !expanded && "rotate-180")}
        />
      ) : null}
    </button>
  );
  return action ? (
    <div className="group/section-header flex min-w-0 items-center">
      <div className="min-w-0 flex-1">{button}</div>
      <div
        className={cn(
          "shrink-0",
          variant === "sidebar" && "w-8 sm:w-7",
          variant === "sidebar" &&
            (actionOpen
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-focus-within/section-header:pointer-events-auto group-focus-within/section-header:opacity-100 group-hover/section-header:pointer-events-auto group-hover/section-header:opacity-100"),
        )}
      >
        {action}
      </div>
    </div>
  ) : (
    button
  );
}

export function SectionHeaderStatus({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 text-3xs leading-none text-destructive-foreground">{children}</span>
  );
}
