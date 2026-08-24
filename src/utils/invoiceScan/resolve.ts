import { CustomerSearchResult, searchCustomers } from '@/api/customers.api';
import { searchAirlines, searchAirports } from '@/api/flightData.api';
import { CodeOption } from '@/components/code-search-field';
import { ticketingName } from '@/utils/ticketingName';

type CodeSearch = (q: string) => Promise<CodeOption[]>;

export interface ScanResolver {
  airline(name: string): Promise<string | null>;
  airport(city: string): Promise<string | null>;
  customer(name: string): Promise<CustomerSearchResult | null>;
}

/**
 * Exactly one match resolves; zero or several return null so the operator picks.
 *
 * These endpoints match on SUBSTRING, not fuzzily, so badly mangled OCR simply fails to resolve.
 * That is deliberate: a flagged field the operator fills in is far better than a confident wrong
 * code silently entering the ledger.
 *
 * Deliberately does NOT catch a transport failure here — it lets it throw, so `memoise()` below
 * can tell "the server genuinely returned zero/several matches" (a real, cacheable answer) apart
 * from "the request itself failed" (must NOT be cached — see `memoise`'s doc comment). The public
 * `ScanResolver` functions built in `buildResolver()` are what convert a throw into `null`.
 */
async function resolveOne(query: string, search: CodeSearch): Promise<string | null> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return null;
  const results = await search(trimmed);
  return results.length === 1 ? results[0].code : null;
}

/**
 * Memoises every SETTLED lookup by its distinct input, so a stack of 80 invoices costs one
 * request per distinct name/city — this is load-bearing, not an optimisation, given how many
 * repeated airlines/cities a real batch contains.
 *
 * A REJECTED lookup is evicted from the cache immediately rather than kept: caching a transient
 * failure (one network blip on the first `ETIHAD AIRWAYS` in the batch) would otherwise fail
 * every later invoice using that same airline for the rest of the session. A genuine
 * zero/several-match result is a RESOLVED value, not a rejection, and is cached exactly like any
 * other resolved value — only an actual thrown/rejected lookup gets retried on its next call.
 */
function memoise<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (key: string) => {
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = load(key).catch((err: unknown): never => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
    return pending;
  };
}

/**
 * Matches a scanned `LAST/FIRST MIDDLE` name against the customer database.
 *
 * `GET /customers/search` substring-matches the WHOLE query against ONE field at a time, so a
 * space-joined "Last First Middle" can never match any single stored field. The query must
 * therefore be one field the scan reliably carries — the last name.
 *
 * All the precision lives in the client-side filter: each candidate's `ticketingName()` is rebuilt
 * and compared case-insensitively against the FULL scanned name, so a same-surname mismatch is
 * rejected rather than guessed.
 *
 * Auto-links ONLY when exactly one candidate matches that full comparison. There is deliberately
 * no looser fallback: a unique surname is not an unambiguous person.
 */
async function resolveCustomerName(name: string): Promise<CustomerSearchResult | null> {
  const [lastNameRaw] = name.split('/');
  const lastName = (lastNameRaw ?? '').trim();
  if (lastName.length < 3) return null;

  const results = await searchCustomers(lastName);
  const wanted = name.trim().toUpperCase();
  const exact = results.filter((c) => ticketingName(c).toUpperCase() === wanted);
  return exact.length === 1 ? exact[0] : null;
}

export function buildResolver(): ScanResolver {
  const airline = memoise((name: string) => resolveOne(name, searchAirlines));
  const airport = memoise((city: string) => resolveOne(city, searchAirports));
  const customer = memoise(resolveCustomerName);
  return {
    // A failed lookup must return null, never throw — one unreachable request must not abort a
    // whole batch. This is the ONLY place that swallows the rejection `memoise` deliberately lets
    // through; swallowing it any earlier would stop `memoise` from telling a real transport
    // failure apart from a genuine empty/ambiguous result (see `memoise`'s doc comment).
    airline: (name) => airline(name).catch(() => null),
    airport: (city) => airport(city).catch(() => null),
    customer: (name) => customer(name).catch(() => null),
  };
}
