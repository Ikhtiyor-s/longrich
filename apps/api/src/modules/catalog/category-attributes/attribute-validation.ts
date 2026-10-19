import { ValidationError } from '../../../common/http/api-error';

// App-allowlist (category_attributes.type is VARCHAR, not a Prisma enum —
// see prisma/schema.prisma's comment + api-contract-g2.md's Prisma field
// reference). Frozen here as the single source of truth both DTOs and the
// service validate against.
export const CATEGORY_ATTRIBUTE_TYPES = [
  'TEXT',
  'ENUM',
  'NUMERIC_RANGE',
  'UNIT',
  'LOCALIZED_TEXT',
] as const;
export type CategoryAttributeType = (typeof CATEGORY_ATTRIBUTE_TYPES)[number];

function fail(message: string): never {
  throw new ValidationError(message, { validation: [message] });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Validates that `validation`'s shape actually matches what `type` requires
// — the ticket's own acceptance bar ("proves only that the rule definition
// itself is well-formed"), not enforcement against a real variant's values
// (that's T-G2-3). The four named payload shapes
// ({enum_values:[...]} / {min,max} / {unit} / {locales:[...]}) come straight
// from api-contract-g2.md's Prisma field reference; TEXT has no payload
// shape named there, so a non-null validation on a TEXT attribute is
// rejected as malformed rather than silently accepted.
export function assertValidAttributeShape(type: CategoryAttributeType, validation: unknown): void {
  switch (type) {
    case 'TEXT': {
      if (validation !== null && validation !== undefined) {
        fail('TEXT attributes must not define a validation payload.');
      }
      return;
    }
    case 'ENUM': {
      if (!isPlainObject(validation) || !Array.isArray(validation.enum_values)) {
        fail('ENUM attributes require validation.enum_values (a non-empty string array).');
      }
      const values = (validation as { enum_values: unknown[] }).enum_values;
      if (values.length === 0 || !values.every((v) => typeof v === 'string' && v.length > 0)) {
        fail('ENUM attributes require validation.enum_values (a non-empty string array).');
      }
      return;
    }
    case 'NUMERIC_RANGE': {
      if (!isPlainObject(validation)) {
        fail('NUMERIC_RANGE attributes require validation.{min,max}.');
      }
      const { min, max } = validation as { min?: unknown; max?: unknown };
      if (
        typeof min !== 'number' ||
        typeof max !== 'number' ||
        !Number.isFinite(min) ||
        !Number.isFinite(max)
      ) {
        fail('NUMERIC_RANGE attributes require validation.{min,max} to both be numbers.');
      }
      if ((min as number) >= (max as number)) {
        fail('NUMERIC_RANGE attributes require validation.min < validation.max.');
      }
      return;
    }
    case 'UNIT': {
      if (
        !isPlainObject(validation) ||
        typeof validation.unit !== 'string' ||
        validation.unit.length === 0
      ) {
        fail('UNIT attributes require validation.unit (a non-empty string).');
      }
      return;
    }
    case 'LOCALIZED_TEXT': {
      if (!isPlainObject(validation) || !Array.isArray(validation.locales)) {
        fail('LOCALIZED_TEXT attributes require validation.locales (a non-empty string array).');
      }
      const locales = (validation as { locales: unknown[] }).locales;
      if (locales.length === 0 || !locales.every((v) => typeof v === 'string' && v.length > 0)) {
        fail('LOCALIZED_TEXT attributes require validation.locales (a non-empty string array).');
      }
      return;
    }
  }
}

// T-G2-3: validates a *value* a variant is submitting against an already-
// well-formed rule (assertValidAttributeShape above only checks the rule
// definition itself, e.g. that validation.enum_values is a non-empty string
// array — it never checks a candidate value against it). Deliberately kept
// in this same file rather than a new one: it reuses CATEGORY_ATTRIBUTE_TYPES,
// isPlainObject, and the same five-way switch shape instead of re-deriving
// the type allowlist elsewhere. UNIT's `{amount, unit}` and LOCALIZED_TEXT's
// locale-keyed-object value shapes are not named anywhere in
// api-contract-g2.md/the ticket text — both are an architect-equivalent gap-
// fill judgment call here, not a frozen contract shape; flagged in the
// implementation report.
export function assertAttributeValueMatchesRule(
  type: CategoryAttributeType,
  validation: unknown,
  key: string,
  value: unknown,
): void {
  const failValue = (message: string): never => {
    throw new ValidationError(message, { [key]: [message] });
  };

  switch (type) {
    case 'TEXT': {
      if (typeof value !== 'string' || value.length === 0) {
        failValue(`attribute "${key}" must be a non-empty string.`);
      }
      return;
    }
    case 'ENUM': {
      const values = (validation as { enum_values: string[] }).enum_values;
      if (typeof value !== 'string' || !values.includes(value)) {
        failValue(`attribute "${key}" must be one of: ${values.join(', ')}.`);
      }
      return;
    }
    case 'NUMERIC_RANGE': {
      const { min, max } = validation as { min: number; max: number };
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        failValue(`attribute "${key}" must be a number between ${min} and ${max}.`);
      }
      return;
    }
    case 'UNIT': {
      const { unit } = validation as { unit: string };
      if (
        !isPlainObject(value) ||
        typeof value.amount !== 'number' ||
        !Number.isFinite(value.amount) ||
        value.unit !== unit
      ) {
        failValue(`attribute "${key}" must be { amount: number, unit: "${unit}" }.`);
      }
      return;
    }
    case 'LOCALIZED_TEXT': {
      const { locales } = validation as { locales: string[] };
      if (!isPlainObject(value)) {
        failValue(`attribute "${key}" must be an object keyed by locale.`);
      }
      const entries = Object.entries(value as Record<string, unknown>);
      if (
        entries.length === 0 ||
        !entries.every(
          ([locale, text]) =>
            locales.includes(locale) && typeof text === 'string' && text.length > 0,
        )
      ) {
        failValue(
          `attribute "${key}" must map each of [${locales.join(', ')}] to a non-empty string.`,
        );
      }
      return;
    }
  }
}
