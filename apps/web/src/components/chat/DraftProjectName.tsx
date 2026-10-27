import { useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";

import { truncateProjectName } from "./DraftProjectName.logic";

export function DraftProjectName({
  value,
  singleLine = false,
}: {
  value: string;
  singleLine?: boolean;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measurementRef = useRef<HTMLSpanElement>(null);
  const [displayName, setDisplayName] = useState(value);

  // oxlint-disable-next-line t3code/react-effect-budget -- Truncation depends on committed DOM width and loaded font metrics.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurement = measurementRef.current;
    if (!container || !measurement) return;

    const update = () => {
      // Measure in the same DOM/font/zoom coordinates as the available space.
      // Canvas metrics can differ enough to truncate even an unconstrained name.
      const availableWidth = container.getBoundingClientRect().width;
      const fittedName = truncateProjectName(value, availableWidth, (text) => {
        measurement.textContent = text;
        return measurement.getBoundingClientRect().width;
      });
      // Preserve the full name's intrinsic width between measurements.
      measurement.textContent = value;
      setDisplayName(fittedName);
    };
    update();
    const stopObserving = observeResize(container, update);
    document.fonts.addEventListener("loadingdone", update);
    return () => {
      stopObserving();
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [value]);

  return (
    <span
      ref={containerRef}
      className={`inline-grid min-w-0 max-w-full overflow-hidden align-baseline whitespace-nowrap ${singleLine ? "text-left" : ""}`}
    >
      {/* Keep the full name's intrinsic width so fitting the visible text cannot shrink its budget. */}
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 min-w-0 overflow-hidden select-none"
      >
        <span ref={measurementRef} className="inline-block w-max">
          {value}
        </span>
      </span>
      <span aria-label={value} className="col-start-1 row-start-1 min-w-0 overflow-hidden">
        {displayName}
      </span>
    </span>
  );
}
