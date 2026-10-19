import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { buildOtpauthUri, generateTotpSecretBase32, verifyTotp } from './lib/totp';

// ADR-001's "external credentials are referenced, never stored in plaintext"
// rule applies here too: the TOTP secret itself is never logged or returned
// from verify(); enroll() returns only a secretReference, and the actual
// secret value lives behind this store interface so a later milestone can
// swap in a real secret manager without changing the service's own shape.
export interface MfaSecretStore {
  save(secretReference: string, secretBase32: string): Promise<void> | void;
  load(secretReference: string): Promise<string | undefined> | string | undefined;
}

@Injectable()
export class InMemoryMfaSecretStore implements MfaSecretStore {
  private readonly secretsByReference = new Map<string, string>();

  save(secretReference: string, secretBase32: string): void {
    this.secretsByReference.set(secretReference, secretBase32);
  }

  load(secretReference: string): string | undefined {
    return this.secretsByReference.get(secretReference);
  }
}

export interface MfaEnrollment {
  secretReference: string;
  qrCodeUri: string;
}

// Scaffold only, per T-G0-5: no admin login/UI flow exists yet to enforce this
// on every admin request (admin members currently authenticate through the
// same /v1/auth/otp/* flow as everyone else). enroll()/verify() are provided
// so a future admin login gate can call them without this interface changing.
// Secret-to-admin-member mapping is in-process memory (InMemoryMfaSecretStore
// default) — not yet persisted to a DB table, since no admin_mfa_* table was
// part of this ticket's migration scope.
@Injectable()
export class AdminMfaService {
  private readonly referenceByAdminMemberId = new Map<string, string>();

  // @Optional() because MfaSecretStore is an interface (no runtime type) —
  // without it Nest's DI throws trying to resolve a token for it instead of
  // falling through to the default in-memory store below.
  constructor(
    @Optional() private readonly secretStore: MfaSecretStore = new InMemoryMfaSecretStore(),
  ) {}

  async enroll(adminMemberId: string): Promise<MfaEnrollment> {
    const secretBase32 = generateTotpSecretBase32();
    const secretReference = `admin-mfa:${adminMemberId}:${randomUUID()}`;
    await this.secretStore.save(secretReference, secretBase32);
    this.referenceByAdminMemberId.set(adminMemberId, secretReference);

    return {
      secretReference,
      qrCodeUri: buildOtpauthUri(secretBase32, adminMemberId),
    };
  }

  async verify(adminMemberId: string, totpCode: string): Promise<boolean> {
    const secretReference = this.referenceByAdminMemberId.get(adminMemberId);
    if (!secretReference) {
      return false;
    }
    const secretBase32 = await this.secretStore.load(secretReference);
    if (!secretBase32) {
      return false;
    }
    return verifyTotp(secretBase32, totpCode);
  }
}
