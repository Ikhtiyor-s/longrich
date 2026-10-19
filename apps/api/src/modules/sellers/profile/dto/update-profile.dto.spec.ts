import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

describe('UpdateProfileDto', () => {
  it('accepts a display_name of exactly 120 characters', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      seller_id: '11111111-1111-4111-8111-111111111111',
      display_name: 'a'.repeat(120),
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a display_name of 121 characters (TZ §28 "public store name max120")', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      seller_id: '11111111-1111-4111-8111-111111111111',
      display_name: 'a'.repeat(121),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'display_name')).toBe(true);
  });

  it('rejects a missing/invalid seller_id', async () => {
    const dto = plainToInstance(UpdateProfileDto, { display_name: 'Honey Store' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'seller_id')).toBe(true);
  });

  // Replicates exactly what createValidationPipe()'s { whitelist: true }
  // does at the HTTP boundary (class-validator's own whitelist option
  // deletes any property without a validation decorator after validate()
  // runs) — proves legal_name/tax_id/legal_type can never survive onto the
  // object ProfileService receives, even if a client includes them in the
  // PATCH body.
  it('strips legal_name/tax_id/legal_type (and any other unknown key) under whitelist:true, same as createValidationPipe()', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      seller_id: '11111111-1111-4111-8111-111111111111',
      display_name: 'Honey Store',
      legal_name: 'Hijacked LLC',
      tax_id: '0000000000',
      legal_type: 'SOLE_PROPRIETOR',
    });

    await validate(dto, { whitelist: true });

    const asRecord = dto as unknown as Record<string, unknown>;
    expect(asRecord.legal_name).toBeUndefined();
    expect(asRecord.tax_id).toBeUndefined();
    expect(asRecord.legal_type).toBeUndefined();
    expect(dto.display_name).toBe('Honey Store');
  });

  it('accepts all four publish-affecting fields within their length bounds', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      seller_id: '11111111-1111-4111-8111-111111111111',
      description: 'Best honey in town',
      logo_object_key: 'seller-logos/seller-1/logo.png',
      working_hours: 'Mon-Fri 09:00-18:00',
      delivery_terms: 'Tashkent shahri boylab 1-2 kun',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
