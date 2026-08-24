import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the search field. */
  'aria-label': string;
  placeholder?: string;
  /** Applied to the wrapper (use for width); the inner input fills it. */
  className?: string;
}

/**
 * A debounce-agnostic text search box with a trailing clear button that empties the input in one click.
 * The clear button only renders when there is something to clear. The `aria-label` lands on the
 * inner `<input>`, so existing `getByLabelText(...)` queries keep resolving to the field itself.
 */
export function SearchInput({ value, onChange, className, placeholder, ...rest }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Input
        aria-label={rest['aria-label']}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full pr-8"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear search"
          className="absolute right-0 top-0 h-8 w-8 text-muted-foreground hover:bg-transparent hover:text-foreground"
          onClick={() => onChange('')}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
