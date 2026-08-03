import { DateField } from '@/components/date-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ConditionOperator,
  ConditionValue,
  GroupCondition,
  GroupFieldMeta,
} from '../api/groups.api';
import { DirectoryUser } from '../api/users.api';
import { OPERATOR_LABELS } from '../utils/conditionLabels';

interface ConditionBuilderProps {
  fields: GroupFieldMeta[];
  users: DirectoryUser[];
  conditions: GroupCondition[];
  onChange: (next: GroupCondition[]) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Relative-date operators whose range is entirely implied — they take no value input at all. */
const VALUELESS_OPERATORS: ConditionOperator[] = ['thisMonth', 'thisYear'];

function defaultValue(field: GroupFieldMeta, operator: ConditionOperator): ConditionValue {
  if (VALUELESS_OPERATORS.includes(operator)) return undefined;
  if (operator === 'inLastDays') return 30;
  if (operator === 'in' || operator === 'notIn') return [];
  if (operator === 'between') return field.type === 'number' ? [0, 0] : [todayIso(), todayIso()];
  switch (field.type) {
    case 'number':
      return 0;
    case 'date':
      return todayIso();
    case 'boolean':
      return false;
    case 'enum':
      return field.enumValues?.[0] ?? '';
    default:
      return '';
  }
}

export default function ConditionBuilder({ fields, users, conditions, onChange }: ConditionBuilderProps) {
  function replaceAt(index: number, next: GroupCondition) {
    onChange(conditions.map((c, i) => (i === index ? next : c)));
  }

  function setValue(index: number, value: ConditionValue) {
    replaceAt(index, { ...conditions[index], value });
  }

  function handleAdd() {
    const field = fields[0];
    if (!field) return;
    const operator = field.operators[0];
    onChange([...conditions, { field: field.key, operator, value: defaultValue(field, operator) }]);
  }

  function handleFieldChange(index: number, key: string) {
    const field = fields.find((f) => f.key === key);
    if (!field) return;
    const operator = field.operators[0];
    replaceAt(index, { field: field.key, operator, value: defaultValue(field, operator) });
  }

  function handleOperatorChange(index: number, operator: ConditionOperator) {
    const field = fields.find((f) => f.key === conditions[index].field);
    if (!field) return;
    replaceAt(index, { ...conditions[index], operator, value: defaultValue(field, operator) });
  }

  function toggleInValue(index: number, member: string) {
    const current = (conditions[index].value as string[]) ?? [];
    const next = current.includes(member) ? current.filter((v) => v !== member) : [...current, member];
    setValue(index, next);
  }

  function renderValueInput(condition: GroupCondition, index: number) {
    const field = fields.find((f) => f.key === condition.field);
    if (!field) return null;
    const label = `Condition ${index + 1} value`;

    // "this month" / "this year" imply their own range — there is nothing to type.
    if (VALUELESS_OPERATORS.includes(condition.operator)) return null;

    if (condition.operator === 'inLastDays') {
      return (
        <Input
          aria-label={label}
          type="number"
          min={1}
          step={1}
          value={String(condition.value ?? '')}
          onChange={(e) => setValue(index, Number(e.target.value) as ConditionValue)}
          className="w-24"
        />
      );
    }

    if (condition.operator === 'between') {
      const pair = condition.value as (string | number)[];
      const inputType = field.type === 'number' ? 'number' : 'date';
      const parse = (raw: string) => (field.type === 'number' ? Number(raw) : raw);
      return (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`${label} from`}
            type={inputType}
            value={String(pair[0] ?? '')}
            onChange={(e) => setValue(index, [parse(e.target.value), pair[1]] as ConditionValue)}
            className="w-36"
          />
          <Input
            aria-label={`${label} to`}
            type={inputType}
            value={String(pair[1] ?? '')}
            onChange={(e) => setValue(index, [pair[0], parse(e.target.value)] as ConditionValue)}
            className="w-36"
          />
        </div>
      );
    }

    if (condition.operator === 'in' || condition.operator === 'notIn') {
      if (field.type === 'enum' || field.type === 'user') {
        const options =
          field.type === 'enum'
            ? (field.enumValues ?? []).map((v) => ({ value: v, label: v }))
            : users.map((u) => ({ value: u.id, label: u.name }));
        const selected = (condition.value as string[]) ?? [];
        return (
          <div className="flex flex-wrap items-center gap-3">
            {options.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  aria-label={`${label} ${o.label}`}
                  checked={selected.includes(o.value)}
                  onCheckedChange={() => toggleInValue(index, o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
        );
      }
      const list = (condition.value as string[]) ?? [];
      return (
        <Input
          aria-label={label}
          value={list.join(',')}
          placeholder="Comma-separated values"
          onChange={(e) =>
            setValue(
              index,
              e.target.value
                .split(',')
                .map((v) => v.trim())
                .filter((v) => v.length > 0)
            )
          }
          className="w-64"
        />
      );
    }

    switch (field.type) {
      case 'number':
        return (
          <Input
            aria-label={label}
            type="number"
            value={String(condition.value ?? 0)}
            onChange={(e) => setValue(index, Number(e.target.value))}
            className="w-36"
          />
        );
      case 'date':
        return (
          <DateField
            ariaLabel={label}
            value={String(condition.value ?? '')}
            onChange={(iso) => setValue(index, iso)}
            className="w-[150px]"
          />
        );
      case 'boolean':
        return (
          <Select
            value={condition.value ? 'true' : 'false'}
            onValueChange={(v) => setValue(index, v === 'true')}
          >
            <SelectTrigger aria-label={label} className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        );
      case 'enum':
        return (
          <Select value={String(condition.value ?? '')} onValueChange={(v) => setValue(index, v)}>
            <SelectTrigger aria-label={label} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(field.enumValues ?? []).map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'user':
        return (
          <Select value={String(condition.value ?? '')} onValueChange={(v) => setValue(index, v)}>
            <SelectTrigger aria-label={label} className="w-44">
              <SelectValue placeholder="Pick a user" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      default:
        return (
          <Input
            aria-label={label}
            value={String(condition.value ?? '')}
            onChange={(e) => setValue(index, e.target.value)}
            className="w-48"
          />
        );
    }
  }

  return (
    <div className="space-y-3">
      {conditions.map((condition, index) => {
        const field = fields.find((f) => f.key === condition.field);
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Select value={condition.field} onValueChange={(v) => handleFieldChange(index, v)}>
              <SelectTrigger aria-label={`Condition ${index + 1} field`} className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={condition.operator}
              onValueChange={(v) => handleOperatorChange(index, v as ConditionOperator)}
            >
              <SelectTrigger aria-label={`Condition ${index + 1} operator`} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(field?.operators ?? []).map((op) => (
                  <SelectItem key={op} value={op}>
                    {OPERATOR_LABELS[op] ?? op}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {renderValueInput(condition, index)}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove condition ${index + 1}`}
              onClick={() => onChange(conditions.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
        Add condition
      </Button>
    </div>
  );
}
