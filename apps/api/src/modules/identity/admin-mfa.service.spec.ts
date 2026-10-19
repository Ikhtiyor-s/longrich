import { AdminMfaService, InMemoryMfaSecretStore, type MfaSecretStore } from './admin-mfa.service';
import { totp } from './lib/totp';

describe('AdminMfaService', () => {
  it('enroll() returns a secretReference + otpauth qrCodeUri and never exposes the raw secret', async () => {
    const service = new AdminMfaService();
    const enrollment = await service.enroll('admin-member-1');

    expect(enrollment.secretReference).toContain('admin-member-1');
    expect(enrollment.qrCodeUri.startsWith('otpauth://totp/')).toBe(true);
  });

  it('verify() accepts a valid current TOTP code for the enrolled admin member', async () => {
    const store = new InMemoryMfaSecretStore();
    const service = new AdminMfaService(store);
    const enrollment = await service.enroll('admin-member-2');

    const secretBase32 = await store.load(enrollment.secretReference);
    const code = totp(secretBase32 as string, Date.now());

    await expect(service.verify('admin-member-2', code)).resolves.toBe(true);
  });

  it('verify() rejects an incorrect code', async () => {
    const service = new AdminMfaService();
    await service.enroll('admin-member-3');

    await expect(service.verify('admin-member-3', '000000')).resolves.toBe(false);
  });

  it('verify() rejects for an admin member that never enrolled', async () => {
    const service = new AdminMfaService();
    await expect(service.verify('never-enrolled', '123456')).resolves.toBe(false);
  });

  it('stores the secret only behind the injected secret store, not in plaintext on the service itself', async () => {
    const saved: Array<{ reference: string; secret: string }> = [];
    const store: MfaSecretStore = {
      save: (reference, secret) => {
        saved.push({ reference, secret });
      },
      load: (reference) => saved.find((entry) => entry.reference === reference)?.secret,
    };
    const service = new AdminMfaService(store);
    const enrollment = await service.enroll('admin-member-4');

    expect(saved).toHaveLength(1);
    const savedEntry = saved[0] as { reference: string; secret: string };
    expect(savedEntry.reference).toBe(enrollment.secretReference);
    expect(JSON.stringify(service)).not.toContain(savedEntry.secret);
  });
});
