import { ApiError } from '../../../common/http/api-error';
import { assertAttributeValueMatchesRule, assertValidAttributeShape } from './attribute-validation';

describe('assertValidAttributeShape', () => {
  it('accepts TEXT with no validation payload', () => {
    expect(() => assertValidAttributeShape('TEXT', undefined)).not.toThrow();
    expect(() => assertValidAttributeShape('TEXT', null)).not.toThrow();
  });

  it('rejects TEXT with a validation payload', () => {
    expect(() => assertValidAttributeShape('TEXT', { foo: 'bar' })).toThrow(ApiError);
  });

  it('accepts a well-formed ENUM payload', () => {
    expect(() => assertValidAttributeShape('ENUM', { enum_values: ['red', 'blue'] })).not.toThrow();
  });

  it.each([[undefined], [null], [{}], [{ enum_values: [] }], [{ enum_values: ['red', 1] }]])(
    'rejects a malformed ENUM payload: %j',
    (validation) => {
      expect(() => assertValidAttributeShape('ENUM', validation)).toThrow(ApiError);
    },
  );

  it('accepts a well-formed NUMERIC_RANGE payload', () => {
    expect(() => assertValidAttributeShape('NUMERIC_RANGE', { min: 0, max: 60 })).not.toThrow();
  });

  it.each([
    [{ min: 10, max: 5 }],
    [{ min: 10, max: 10 }],
    [{ min: '0', max: 60 }],
    [{ max: 60 }],
    [{}],
  ])('rejects a malformed NUMERIC_RANGE payload: %j', (validation) => {
    expect(() => assertValidAttributeShape('NUMERIC_RANGE', validation)).toThrow(ApiError);
  });

  it('accepts a well-formed UNIT payload', () => {
    expect(() => assertValidAttributeShape('UNIT', { unit: 'kg' })).not.toThrow();
  });

  it.each([[{ unit: '' }], [{}], [null]])('rejects a malformed UNIT payload: %j', (validation) => {
    expect(() => assertValidAttributeShape('UNIT', validation)).toThrow(ApiError);
  });

  it('accepts a well-formed LOCALIZED_TEXT payload', () => {
    expect(() =>
      assertValidAttributeShape('LOCALIZED_TEXT', { locales: ['uz', 'ru'] }),
    ).not.toThrow();
  });

  it.each([[{ locales: [] }], [{}], [{ locales: ['uz', 5] }]])(
    'rejects a malformed LOCALIZED_TEXT payload: %j',
    (validation) => {
      expect(() => assertValidAttributeShape('LOCALIZED_TEXT', validation)).toThrow(ApiError);
    },
  );
});

describe('assertAttributeValueMatchesRule', () => {
  it('accepts a non-empty string for TEXT and rejects everything else', () => {
    expect(() => assertAttributeValueMatchesRule('TEXT', null, 'origin', 'Uzbekistan')).not.toThrow();
    expect(() => assertAttributeValueMatchesRule('TEXT', null, 'origin', '')).toThrow(ApiError);
    expect(() => assertAttributeValueMatchesRule('TEXT', null, 'origin', 5)).toThrow(ApiError);
  });

  it('accepts a value present in ENUM.enum_values and rejects anything else', () => {
    const validation = { enum_values: ['red', 'blue'] };
    expect(() => assertAttributeValueMatchesRule('ENUM', validation, 'color', 'red')).not.toThrow();
    expect(() => assertAttributeValueMatchesRule('ENUM', validation, 'color', 'green')).toThrow(
      ApiError,
    );
  });

  it('accepts a number within NUMERIC_RANGE.{min,max} and rejects out-of-range/non-numeric', () => {
    const validation = { min: 0, max: 60 };
    expect(() =>
      assertAttributeValueMatchesRule('NUMERIC_RANGE', validation, 'warranty_months', 12),
    ).not.toThrow();
    expect(() =>
      assertAttributeValueMatchesRule('NUMERIC_RANGE', validation, 'warranty_months', 61),
    ).toThrow(ApiError);
    expect(() =>
      assertAttributeValueMatchesRule('NUMERIC_RANGE', validation, 'warranty_months', '12'),
    ).toThrow(ApiError);
  });

  it('accepts { amount, unit } matching UNIT.unit and rejects a mismatched unit', () => {
    const validation = { unit: 'kg' };
    expect(() =>
      assertAttributeValueMatchesRule('UNIT', validation, 'weight', { amount: 2.5, unit: 'kg' }),
    ).not.toThrow();
    expect(() =>
      assertAttributeValueMatchesRule('UNIT', validation, 'weight', { amount: 2.5, unit: 'lb' }),
    ).toThrow(ApiError);
  });

  it('accepts a locale-keyed object covering only LOCALIZED_TEXT.locales and rejects an unknown locale', () => {
    const validation = { locales: ['uz', 'ru'] };
    expect(() =>
      assertAttributeValueMatchesRule('LOCALIZED_TEXT', validation, 'name', {
        uz: 'Nomi',
        ru: 'Имя',
      }),
    ).not.toThrow();
    expect(() =>
      assertAttributeValueMatchesRule('LOCALIZED_TEXT', validation, 'name', { en: 'Name' }),
    ).toThrow(ApiError);
  });
});
