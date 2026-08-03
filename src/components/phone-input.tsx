import { Phone } from 'lucide-react';
import { IconInput } from '@/components/icon-input';
import { maskPhoneInput } from '@/utils/phoneFormat';

interface PhoneInputProps {
  id?: string;
  value: string;
  /** Receives the masked string directly, NOT a change event. */
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  'aria-label'?: string;
  className?: string;
}

/**
 * A phone field that formats as you type: `(832)-555-1234`. Staff only ever
 * press number keys — the parens and dashes appear on their own.
 *
 * The field is empty (not a `(___)-___-____` template) when blank, because
 * phone is optional on customers and a permanent template makes an empty field
 * look populated.
 *
 * `maskPhoneInput` passes a value starting with '+' straight through, so an
 * international number can still be entered.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  placeholder = '(832)-555-1234',
  required,
  className,
  'aria-label': ariaLabel,
}: PhoneInputProps) {
  return (
    <IconInput
      id={id}
      icon={<Phone />}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      aria-label={ariaLabel}
      className={className}
      required={required}
      placeholder={placeholder}
      value={maskPhoneInput(value)}
      onChange={(e) => onChange(maskPhoneInput(e.target.value))}
    />
  );
}
