import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ConditionBuilder from './ConditionBuilder';
import { GroupCondition, GroupFieldMeta } from '../api/groups.api';

const FIELDS: GroupFieldMeta[] = [
  { key: 'airlineCode', label: 'Airline', type: 'string', operators: ['equals', 'contains', 'in', 'notIn'] },
  { key: 'amount', label: 'Amount', type: 'number', operators: ['equals', 'greaterThan', 'lessThan', 'between'] },
  {
    key: 'date',
    label: 'Booking date',
    type: 'date',
    operators: ['equals', 'greaterThan', 'lessThan', 'between', 'inLastDays', 'thisMonth', 'thisYear'],
  },
  { key: 'paymentType', label: 'Payment type', type: 'enum', enumValues: ['card', 'check', 'cash'], operators: ['equals', 'in', 'notIn'] },
  { key: 'customerVerified', label: 'Customer verified', type: 'boolean', operators: ['equals'] },
];
const USERS = [{ id: 'u1', name: 'Anna' }];

// The component is fully controlled, so the test harness must own state and
// feed onChange back into the conditions prop — a bare spy would freeze the
// inputs and multi-character typing could never accumulate.
function Harness({ initial, onChange }: { initial: GroupCondition[]; onChange: (next: GroupCondition[]) => void }) {
  const [conditions, setConditions] = useState(initial);
  return (
    <ConditionBuilder
      fields={FIELDS}
      users={USERS}
      conditions={conditions}
      onChange={(next) => {
        setConditions(next);
        onChange(next);
      }}
    />
  );
}

function setup(conditions: GroupCondition[] = []) {
  const onChange = vi.fn();
  render(<Harness initial={conditions} onChange={onChange} />);
  return onChange;
}

async function pick(name: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('ConditionBuilder relative-date operators', () => {
  it('emits no value for "this year" — the range is implied, so there is nothing to type', async () => {
    const onChange = setup([{ field: 'date', operator: 'equals', value: '2026-05-04' }]);

    await pick('Condition 1 operator', 'this year');

    expect(onChange).toHaveBeenCalledWith([{ field: 'date', operator: 'thisYear', value: undefined }]);
    expect(screen.queryByLabelText('Condition 1 value')).not.toBeInTheDocument();
  });

  it('offers a day-count input for "in the last (days)", defaulting to 30', async () => {
    const onChange = setup([{ field: 'date', operator: 'equals', value: '2026-05-04' }]);

    await pick('Condition 1 operator', 'in the last (days)');

    expect(onChange).toHaveBeenLastCalledWith([{ field: 'date', operator: 'inLastDays', value: 30 }]);
    const input = screen.getByLabelText('Condition 1 value');
    expect(input).toHaveValue(30);

    await userEvent.clear(input);
    await userEvent.type(input, '7');
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'date', operator: 'inLastDays', value: 7 }]);
  });

  it('labels operators in plain English rather than raw camelCase keys', async () => {
    setup([{ field: 'date', operator: 'equals', value: '2026-05-04' }]);

    await userEvent.click(screen.getByRole('combobox', { name: 'Condition 1 operator' }));

    expect(await screen.findByRole('option', { name: 'this month' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'thisMonth' })).not.toBeInTheDocument();
  });
});

describe('ConditionBuilder', () => {
  it('adds a default condition (first field, first operator, empty value)', async () => {
    const onChange = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    expect(onChange).toHaveBeenCalledWith([{ field: 'airlineCode', operator: 'equals', value: '' }]);
  });

  it('only offers the field-type operators, and typing a string value emits it', async () => {
    const onChange = setup([{ field: 'airlineCode', operator: 'equals', value: '' }]);
    await userEvent.click(screen.getByRole('combobox', { name: 'Condition 1 operator' }));
    const options = await screen.findAllByRole('option');
    // Displayed as human labels ('in' reads as 'is one of', 'notIn' as 'is not one of'), though the
    // emitted keys are unchanged.
    expect(options.map((o) => o.textContent)).toEqual(['equals', 'contains', 'is one of', 'is not one of']);
    await userEvent.click(options[0]);

    await userEvent.type(screen.getByRole('textbox', { name: 'Condition 1 value' }), 'Q');
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'airlineCode', operator: 'equals', value: 'Q' }]);
  });

  it('notIn takes the same multi-value input as in, and emits the notIn operator', async () => {
    const onChange = setup([{ field: 'airlineCode', operator: 'notIn', value: [] }]);
    const input = screen.getByRole('textbox', { name: 'Condition 1 value' });
    // The multi-value comma input, not the single-value equals/contains input.
    expect(input).toHaveAttribute('placeholder', 'Comma-separated values');
    await userEvent.type(input, 'QR');
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'airlineCode', operator: 'notIn', value: ['QR'] }]);
  });

  it('switching field resets operator and value; number between renders two inputs', async () => {
    const onChange = setup([{ field: 'airlineCode', operator: 'contains', value: 'QR' }]);
    await pick('Condition 1 field', 'Amount');
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'amount', operator: 'equals', value: 0 }]);

    onChange.mockClear();
    render(<Harness initial={[{ field: 'amount', operator: 'between', value: [0, 0] }]} onChange={onChange} />);
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Condition 1 value from' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Condition 1 value from' }), '10');
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'amount', operator: 'between', value: [10, 0] }]);
    expect(screen.getByRole('spinbutton', { name: 'Condition 1 value to' })).toBeInTheDocument();
  });

  // Both numeric fields the registry offers are money (Amount, Amount owed), so the default step of
  // 1 made "amount greater than 450.50" a stepMismatch. `any` rather than `0.01` because this input
  // is registry-driven — a future non-money number field must not inherit a two-decimal constraint.
  it('does not constrain a numeric value to whole numbers', () => {
    setup([{ field: 'amount', operator: 'greaterThan', value: 0 }]);
    expect(screen.getByRole('spinbutton', { name: 'Condition 1 value' })).toHaveAttribute('step', 'any');
  });

  it('enum in renders one checkbox per value; boolean renders a Yes/No select', async () => {
    const onChange = setup([{ field: 'paymentType', operator: 'in', value: [] }]);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Condition 1 value cash' }));
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'paymentType', operator: 'in', value: ['cash'] }]);

    onChange.mockClear();
    render(<Harness initial={[{ field: 'customerVerified', operator: 'equals', value: false }]} onChange={onChange} />);
    await pick('Condition 1 value', 'Yes');
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'customerVerified', operator: 'equals', value: true }]);
  });

  it('removes a condition', async () => {
    const onChange = setup([
      { field: 'airlineCode', operator: 'equals', value: 'QR' },
      { field: 'amount', operator: 'equals', value: 5 },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove condition 1' }));
    expect(onChange).toHaveBeenCalledWith([{ field: 'amount', operator: 'equals', value: 5 }]);
  });
});
