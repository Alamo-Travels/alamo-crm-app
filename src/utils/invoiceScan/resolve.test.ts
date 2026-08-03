import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildResolver } from './resolve';
import * as flightData from '@/api/flightData.api';
import * as customers from '@/api/customers.api';

vi.mock('@/api/flightData.api');
vi.mock('@/api/customers.api');

describe('buildResolver', () => {
  beforeEach(() => {
    vi.mocked(flightData.searchAirlines).mockReset();
    vi.mocked(flightData.searchAirports).mockReset();
    vi.mocked(customers.searchCustomers).mockReset();
  });

  it('resolves an airline name to its code', async () => {
    vi.mocked(flightData.searchAirlines).mockResolvedValue([{ code: 'EY', label: 'Etihad Airways' }]);
    const resolver = buildResolver();
    await expect(resolver.airline('ETIHAD AIRWAYS')).resolves.toBe('EY');
  });

  it('queries each distinct name only once', async () => {
    vi.mocked(flightData.searchAirlines).mockResolvedValue([{ code: 'QR', label: 'Qatar Airways' }]);
    const resolver = buildResolver();
    await resolver.airline('QATAR AIRWAYS');
    await resolver.airline('QATAR AIRWAYS');
    expect(flightData.searchAirlines).toHaveBeenCalledTimes(1);
  });

  it('returns null rather than guessing when nothing matches', async () => {
    vi.mocked(flightData.searchAirports).mockResolvedValue([]);
    const resolver = buildResolver();
    await expect(resolver.airport('ATIANTA')).resolves.toBeNull();
  });

  it('returns null rather than guessing when the match is ambiguous', async () => {
    vi.mocked(flightData.searchAirports).mockResolvedValue([
      { code: 'ORD', label: "Chicago O'Hare", sublabel: 'Chicago, US' },
      { code: 'MDW', label: 'Chicago Midway', sublabel: 'Chicago, US' },
    ]);
    const resolver = buildResolver();
    await expect(resolver.airport('CHICAGO')).resolves.toBeNull();
  });

  it('auto-links a passenger when exactly one customer matches', async () => {
    vi.mocked(customers.searchCustomers).mockResolvedValue([
      { id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '02-Sep-1953' },
    ]);
    const resolver = buildResolver();
    await expect(resolver.customer('JACOB/SHIBIN THOMAS')).resolves.toMatchObject({ id: 'c1' });
  });

  it('does not auto-link when several customers match', async () => {
    vi.mocked(customers.searchCustomers).mockResolvedValue([
      { id: 'c1', firstName: 'Shibin', lastName: 'Jacob', dob: '02-Sep-1953' },
      { id: 'c2', firstName: 'Shibin', lastName: 'Jacob', dob: '10-Jan-1980' },
    ]);
    const resolver = buildResolver();
    await expect(resolver.customer('JACOB/SHIBIN')).resolves.toBeNull();
  });

  // Fix round 1 — Critical 1: GET /customers/search substring-matches the WHOLE query string
  // against ONE field at a time ($or: [firstName, lastName, middleName]), so a space-joined
  // "Last First Middle" query can never be a substring of any single stored field. The resolver
  // must query on a single field (the last name) and push precision into a client-side filter.
  it('queries the customer search by last name only, since the backend can only substring-match within a single field', async () => {
    vi.mocked(customers.searchCustomers).mockResolvedValue([
      { id: 'c1', firstName: 'Shibin', middleName: 'Thomas', lastName: 'Jacob', dob: '02-Sep-1953' },
    ]);
    const resolver = buildResolver();
    await resolver.customer('JACOB/SHIBIN THOMAS');
    expect(customers.searchCustomers).toHaveBeenCalledWith('JACOB');
  });

  // Fix round 1 — Critical 2: a shared surname must not be enough to auto-link. The old loose
  // fallback ("only one raw result came back") would wrongly attach this booking to c1 even
  // though the given name doesn't match at all.
  it('does not auto-link a candidate whose surname matches but given name does not', async () => {
    vi.mocked(customers.searchCustomers).mockResolvedValue([
      { id: 'c1', firstName: 'John', lastName: 'Jacob', dob: '02-Sep-1953' },
    ]);
    const resolver = buildResolver();
    await expect(resolver.customer('JACOB/SHIBIN')).resolves.toBeNull();
  });

  it('survives a failed lookup without throwing', async () => {
    vi.mocked(flightData.searchAirlines).mockRejectedValue(new Error('offline'));
    const resolver = buildResolver();
    await expect(resolver.airline('ETIHAD AIRWAYS')).resolves.toBeNull();
  });

  // Fix round 1 — Important 3: a transient failure (network blip) must not be cached as a
  // permanent null — the next invoice for the same airline should get a fresh attempt, not
  // inherit the first blip's failure for the rest of the session.
  it('retries after a transient failure instead of caching it as a permanent null', async () => {
    vi.mocked(flightData.searchAirlines)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ code: 'EY', label: 'Etihad Airways' }]);
    const resolver = buildResolver();
    await expect(resolver.airline('ETIHAD AIRWAYS')).resolves.toBeNull();
    await expect(resolver.airline('ETIHAD AIRWAYS')).resolves.toBe('EY');
    expect(flightData.searchAirlines).toHaveBeenCalledTimes(2);
  });
});
