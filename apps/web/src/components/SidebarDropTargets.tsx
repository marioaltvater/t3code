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
  "absolute inset-0 flex min-h-0 flex-col items-center justify-center rounded-lg border border-dashed border-sidebar-foreground/20 px-3 text-sm leading-5 font-medium text-sidebar-foreground/80";

export function SidebarDropBox({ destination }: { destination: SidebarDropDestination }) {
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
