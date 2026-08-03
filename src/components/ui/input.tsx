import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, ...props }, ref) => {
    // A FOCUSED <input type="number"> steps its value on mouse-wheel scroll. Nearly every number
    // input in this app is a money amount, so scrolling a long form after clicking into one
    // silently rewrites a ledger figure with nothing on screen to show for it. Blurring hands the
    // scroll back to the page and leaves the value alone.
    //
    // Blur rather than preventDefault: React registers `wheel` passively at the root, so
    // e.preventDefault() is a no-op here — and a native non-passive listener that did cancel it
    // would also cancel the page scroll, freezing the form whenever the pointer crossed a field.
    //
    // Gated on the input actually being focused, which is the only state the browser steps in. An
    // unfocused field is left completely alone: no blur, no focus change, page scrolls as normal.
    const handleWheel = (event: React.WheelEvent<HTMLInputElement>) => {
      if (type === "number" && document.activeElement === event.currentTarget) {
        event.currentTarget.blur()
      }
      onWheel?.(event)
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        onWheel={handleWheel}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
