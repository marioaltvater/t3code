import { useDroppable } from "@dnd-kit/core";
import { cn } from "../lib/utils";

export type SidebarDropDestination = {
  id: string;
  label: string;
  count?: number;
  disabled: boolean;
  size?: "half";
};

const sidebarSectionBoxClassName =
  "absolute inset-0 flex min-h-0 flex-col justify-center rounded-lg border border-dashed border-sidebar-foreground/20 text-sm leading-5 font-medium text-sidebar-foreground/80";

export function SidebarDropBox({
  destination,
  align = "center",
}: {
  destination: SidebarDropDestination;
  align?: "start" | "center";
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: destination.id,
    disabled: destination.disabled,
  });
  return (
    <div
      ref={setNodeRef}
      aria-disabled={destination.disabled}
      data-drop-accepted={(isOver && !destination.disabled) || undefined}
      data-testid={destination.id}
      className={cn(
        sidebarSectionBoxClassName,
        align === "start" ? "items-start px-2" : "items-center px-3",
        isOver &&
          "border-transparent bg-primary/20 text-sidebar-foreground ring-2 ring-inset ring-primary",
        destination.disabled && "opacity-40",
      )}
    >
      <span className="max-w-full truncate">
        {destination.label}
        {destination.count === undefined ? null : ` (${destination.count})`}
      </span>
    </div>
  );
}
