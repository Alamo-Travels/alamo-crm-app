import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddEditCustomerDialog } from './add-edit-customer-dialog';
import { useAuthStore } from '@/stores/authStore';
import { readDraft, writeDraft } from '@/utils/formDraft';

vi.mock('@/api/customers.api', async (importActual) => ({
  ...(await importActual<typeof import('@/api/customers.api')>()),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
}));

const USER = { id: 'u1', name: 'Agent', email: 'a@example.com', role: 'superadmin' as const };

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AddEditCustomerDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  );
  return { onOpenChange };
}

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ accessToken: 't', user: USER });
});

describe('AddEditCustomerDialog drafts', () => {
  it('auto-saves what is typed', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText('First name'), 'Jane');

    await waitFor(
      () =>
        expect(readDraft<{ form: { firstName: string } }>('u1', 'customer')?.state.form.firstName).toBe(
          'Jane'
        ),
      { timeout: 2000 }
    );
  });

  it('restores a stored draft on demand', async () => {
    writeDraft('u1', 'customer', {
      form: {
        firstName: 'Restored',
        middleName: '',
        lastName: 'Person',
        dob: '',
        gender: 'M',
        verified: false,
        phone: '',
        email: '',
        passportNumber: '',
        passportIssuingCountry: '',
        passportExpiryDate: '',
      },
      passportFileName: null,
    });

    renderDialog();
    expect(screen.getByLabelText('First name')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    // Every drafted field actually landed, not just First name — a restore that dropped
    // middleName/lastName would still pass a check of First name alone. Probe-verified: this
    // failed (Last name stayed '') when `setForm(restored.form)` was replaced with a partial
    // spread dropping lastName. See the task report for the exact failure output.
    expect(screen.getByLabelText('First name')).toHaveValue('Restored');
    expect(screen.getByLabelText('Middle name')).toHaveValue('');
    expect(screen.getByLabelText('Last name')).toHaveValue('Person');
  });

  it('tells the user a passport file was not saved', () => {
    writeDraft('u1', 'customer', {
      form: {
        firstName: 'Jane',
        middleName: '',
        lastName: '',
        dob: '',
        gender: 'M',
        verified: false,
        phone: '',
        email: '',
        passportNumber: '',
        passportIssuingCountry: '',
        passportExpiryDate: '',
      },
      passportFileName: 'scan.pdf',
    });

    renderDialog();
    expect(screen.getByText(/scan\.pdf was not saved/i)).toBeInTheDocument();
  });

  it('does not draft while EDITING an existing customer', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AddEditCustomerDialog
          open
          onOpenChange={vi.fn()}
          customer={{
            id: 'c1',
            firstName: 'Existing',
            middleName: '',
            lastName: 'Customer',
            dob: '02-Sep-1953',
            gender: 'M',
            verified: true,
            phone: '',
            email: '',
            paxType: 'ADT',
          } as never}
        />
      </QueryClientProvider>
    );

    await userEvent.type(screen.getByLabelText('First name'), 'X');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(readDraft('u1', 'customer')).toBeNull();
  });

  it('Cancel with content asks before discarding', async () => {
    const { onOpenChange } = renderDialog();
    await userEvent.type(screen.getByLabelText('First name'), 'Jane');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/leave this customer/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Discard it' }));
    expect(readDraft('u1', 'customer')).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
