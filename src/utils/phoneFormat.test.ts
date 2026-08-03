import { describe, expect, it } from 'vitest';
import { formatPhone, maskPhoneInput, phoneCopyValue } from './phoneFormat';

describe('formatPhone', () => {
  it('formats a stored 10-digit number', () => {
    expect(formatPhone('8325551234')).toBe('(832)-555-1234');
  });

  it('formats a legacy already-punctuated 10-digit value', () => {
    expect(formatPhone('(832) 555-1234')).toBe('(832)-555-1234');
  });

  it('leaves a + number alone even when it holds exactly 10 digits', () => {
    expect(formatPhone('+1234567890')).toBe('+1234567890');
  });

  it('leaves an international number as-is', () => {
    expect(formatPhone('+91 98765 43210')).toBe('+91 98765 43210');
  });

  it('leaves a non-10-digit value as-is', () => {
    expect(formatPhone('832555')).toBe('832555');
  });

  it('renders an absent value as an empty string', () => {
    expect(formatPhone('')).toBe('');
    expect(formatPhone(undefined)).toBe('');
    expect(formatPhone(null)).toBe('');
  });
});

describe('phoneCopyValue', () => {
  it('copies a US number as bare digits', () => {
    expect(phoneCopyValue('8325551234')).toBe('8325551234');
    expect(phoneCopyValue('(832) 555-1234')).toBe('8325551234');
  });

  it('copies anything else verbatim, so a + is never lost', () => {
    expect(phoneCopyValue('+91 98765 43210')).toBe('+91 98765 43210');
    expect(phoneCopyValue('832555')).toBe('832555');
  });

  // Pins the load-bearing rule order: isInternational() must be checked BEFORE
  // the 10-digit check. Swap them and this returns '1234567890', dropping the '+'.
  it('leaves a + number alone even when it holds exactly 10 digits', () => {
    expect(phoneCopyValue('+1234567890')).toBe('+1234567890');
  });

  it('handles an absent value', () => {
    expect(phoneCopyValue(undefined)).toBe('');
  });
});

describe('maskPhoneInput', () => {
  it('formats progressively as digits are typed', () => {
    expect(maskPhoneInput('')).toBe('');
    expect(maskPhoneInput('8')).toBe('(8');
    expect(maskPhoneInput('832')).toBe('(832');
    expect(maskPhoneInput('8325')).toBe('(832)-5');
    expect(maskPhoneInput('832555')).toBe('(832)-555');
    expect(maskPhoneInput('8325551')).toBe('(832)-555-1');
    expect(maskPhoneInput('8325551234')).toBe('(832)-555-1234');
  });

  it('re-masks an already-formatted value so backspace walks back', () => {
    expect(maskPhoneInput('(832)-555-123')).toBe('(832)-555-123');
    expect(maskPhoneInput('(832)-')).toBe('(832');
  });

  it('passes a + value through untouched, as an international escape hatch', () => {
    expect(maskPhoneInput('+91 98765 43210')).toBe('+91 98765 43210');
    expect(maskPhoneInput('+')).toBe('+');
  });

  it('renders more than 10 digits plain rather than blocking them', () => {
    expect(maskPhoneInput('18325551234')).toBe('18325551234');
  });

  it('ignores non-digit keystrokes', () => {
    expect(maskPhoneInput('abc832def555')).toBe('(832)-555');
  });
});
