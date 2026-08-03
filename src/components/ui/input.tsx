import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, min, onWheel, onKeyDown, onPaste, ...props }, ref) => {
    // `min="0"` on a number input only marks the field INVALID on submit — the browser still lets a
    // minus sign be typed, so a negative sits there looking accepted until the user tries to save.
    // Nearly every number input in this app is a money amount, and a negative one is meaningless.
    //
    // This enforces the floor the field itself declared; it is not a new app-wide policy. A number
    // input with no `min` (or a negative one) keeps accepting negatives.
    const forbidsNegative = type === "number" && min !== undefined && Number(min) >= 0

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (forbidsNegative && (event.key === "-" || event.key === "Subtract")) {
        event.preventDefault()
      }
      // ArrowUp/ArrowDown are the third way the browser steps a number field, after the spin
      // buttons (hidden app-wide in index.css) and the mouse wheel (guarded above). Same silent
      // rewrite of a money figure, so the same answer. Nothing is lost: arrows do not move the
      // caret in a single-line input, and Left/Right — which do — are untouched.
      if (type === "number" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault()
      }
      onKeyDown?.(event)
    }

    // Typing is not the only way in. Guarded separately rather than sanitising the pasted text,
    // so nothing silently rewrites what the user pasted — the paste is simply refused.
    const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
      if (forbidsNegative && event.clipboardData.getData("text").includes("-")) {
        event.preventDefault()
      }
      onPaste?.(event)
    }

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
        min={min}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
