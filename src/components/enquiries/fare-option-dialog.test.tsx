import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_TIME_ZONE, agencyToday } from '@/utils/agencyTime';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FareOptionDialog } from './fare-option-dialog';
import * as flightDataApi from '@/api/flightData.api';
import { EnquiryFareOption } from '@/api/enquiries.api';
import { FUTURE_DEP_DATE } from '@/test-utils/dates';

// The components floor these date inputs on `agencyToday(timeZone)` — the AGENCY-local calendar
// day (America/Chicago by default; none of these tests mocks branding, so the fallback applies).
// This constant used to be `new Date().toISOString().slice(0, 10)`, i.e. the UTC day, which agrees
// with the agency day only for the 18-19 hours a day that UTC and Chicago share a date. Between
// 00:00 UTC and local midnight — 19:00-24:00 Chicago time — UTC is already tomorrow and all three
// of these assertions failed, every single night. Deriving the expectation the same way the
// component does removes the skew by construction rather than re-pinning it to a different clock.
const TODAY = agencyToday(DEFAULT_TIME_ZONE);

vi.mock('@/api/flightData.api');

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(flightDataApi.searchAirports).mockResolvedValue([]);
  vi.mocked(flightDataApi.searchAirlines).mockResolvedValue([]);
});

describe('FareOptionDialog', () => {
  it('submits only the adult price when child and infant are blank', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<FareOptionDialog open onOpenChange={() => {}} onSave={onSave} />, { wrapper });

    await user.type(screen.getByLabelText('Airline'), 'Spirit');
    await user.type(screen.getByLabelText('Adult fare'), '220');
    await user.type(screen.getByLabelText('Segment 1 from'), 'IAH');
    await user.type(screen.getByLabelText('Segment 1 to'), 'LAX');
    await user.type(screen.getByLabelText('Segment 1 date'), FUTURE_DEP_DATE);
    await user.click(screen.getByRole('button', { name: 'Save option' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ prices: { adult: 220, child: undefined, infant: undefined } })
    );
  });

  it('submits all three fares when all are filled', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<FareOptionDialog open onOpenChange={() => {}} onSave={onSave} />, { wrapper });

    await user.type(screen.getByLabelText('Airline'), 'Spirit');
    await user.type(screen.getByLabelText('Adult fare'), '220');
    await user.type(screen.getByLabelText('Child fare'), '180');
    await user.type(screen.getByLabelText('Infant fare'), '25');
    await user.type(screen.getByLabelText('Segment 1 from'), 'IAH');
    await user.type(screen.getByLabelText('Segment 1 to'), 'LAX');
    await user.type(screen.getByLabelText('Segment 1 date'), FUTURE_DEP_DATE);
    await user.click(screen.getByRole('button', { name: 'Save option' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ prices: { adult: 220, child: 180, infant: 25 } })
    );
  });

  it('accepts a 24hr time and submits it unchanged', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<FareOptionDialog open onOpenChange={() => {}} onSave={onSave} />, { wrapper });

    await user.type(screen.getByLabelText('Airline'), 'Spirit');
    await user.type(screen.getByLabelText('Adult fare'), '220');
    await user.type(screen.getByLabelText('Segment 1 from'), 'IAH');
    await user.type(screen.getByLabelText('Segment 1 to'), 'LAX');
    await user.type(screen.getByLabelText('Segment 1 date'), FUTURE_DEP_DATE);
    await user.type(screen.getByLabelText('Segment 1 depart time'), '06:20');
    await user.type(screen.getByLabelText('Segment 1 arrive time'), '14:53');
    await user.click(screen.getByRole('button', { name: 'Save option' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: [expect.objectContaining({ departTime: '06:20', arriveTime: '14:53' })],
      })
    );
  });

  it('rejects an out-of-range time', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<FareOptionDialog open onOpenChange={() => {}} onSave={onSave} />, { wrapper });

    await user.type(screen.getByLabelText('Airline'), 'Spirit');
    await user.type(screen.getByLabelText('Adult fare'), '220');
    await user.type(screen.getByLabelText('Segment 1 from'), 'IAH');
    await user.type(screen.getByLabelText('Segment 1 to'), 'LAX');
    await user.type(screen.getByLabelText('Segment 1 date'), FUTURE_DEP_DATE);

    const departTime = screen.getByLabelText('Segment 1 depart time');
    await user.type(departTime, '25:00');

    // The pattern is what blocks submit — assert on validity too, since jsdom does not render
    // native validation bubbles — but the real point is that clicking Save must not fire onSave.
    expect((departTime as HTMLInputElement).checkValidity()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Save option' }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('labels the depart and arrive time fields visibly', () => {
    render(<FareOptionDialog open onOpenChange={() => {}} onSave={vi.fn()} />, { wrapper });

    expect(screen.getByText('Depart')).toBeInTheDocument();
    expect(screen.getByText('Arrive')).toBeInTheDocument();
  });

  it('edit: a blank child fare is not resurrected as 0 or NaN on an unchanged save', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const initial: EnquiryFareOption = {
      airlineName: 'Spirit',
      prices: { adult: 220 },
      segments: [{ from: 'IAH', to: 'LAX', date: '2026-07-08' }],
    };
    render(<FareOptionDialog open onOpenChange={() => {}} initial={initial} onSave={onSave} />, { wrapper });

    await user.click(screen.getByRole('button', { name: 'Save option' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0] as EnquiryFareOption;
    expect(arg.prices.adult).toBe(220);
    expect(arg.prices.child).toBeUndefined();
    expect(arg.prices.infant).toBeUndefined();
  });

  it('edit: a genuine 0 child fare survives an unchanged save', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    const initial: EnquiryFareOption = {
      airlineName: 'Spirit',
      prices: { adult: 220, child: 0 },
      segments: [{ from: 'IAH', to: 'LAX', date: '2026-07-08' }],
    };
    render(<FareOptionDialog open onOpenChange={() => {}} initial={initial} onSave={onSave} />, { wrapper });

    await user.click(screen.getByRole('button', { name: 'Save option' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0] as EnquiryFareOption;
    expect(arg.prices.child).toBe(0);
  });
});

describe('FareOptionDialog future-only segment dates', () => {
  it('floors a newly quoted segment at today', () => {
    render(<FareOptionDialog open onOpenChange={() => {}} onSave={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText('Segment 1 date')).toHaveAttribute('min', TODAY);
  });

  it('does NOT floor the segments when editing an existing option', () => {
    const existing: EnquiryFareOption = {
      airlineName: 'Spirit',
      prices: { adult: 220 },
      segments: [{ from: 'IAH', to: 'LAX', date: '2024-03-01' }],
    };
    render(<FareOptionDialog open onOpenChange={() => {}} initial={existing} onSave={vi.fn()} />, { wrapper });
    expect(screen.getByLabelText('Segment 1 date')).not.toHaveAttribute('min');
  });
});
