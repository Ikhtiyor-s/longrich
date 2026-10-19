import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OwnershipGuard } from './ownership.guard';
import {
  OWNERSHIP_METADATA_KEY,
  RequireOwnership,
} from '../decorators/require-ownership.decorator';

interface FakeSellerOffer {
  id: string;
  sellerId: string;
}

function createContext(request: unknown, klass: unknown = class Fixture {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => klass,
  } as unknown as ExecutionContext;
}

function buildGuard(resolver: unknown) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(resolver),
  } as unknown as Reflector;
  return new OwnershipGuard(reflector);
}

describe('OwnershipGuard', () => {
  const resolveSellerOwner = (_req: unknown, resource: FakeSellerOffer) => resource.sellerId;

  it('passes through when no @RequireOwnership metadata is set on the handler', () => {
    const guard = buildGuard(undefined);
    const context = createContext({ user: { id: 'user-1' } });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request when the resolved owner id matches the caller', () => {
    const guard = buildGuard(resolveSellerOwner);
    const fakeResource: FakeSellerOffer = { id: 'offer-1', sellerId: 'seller-1' };
    const context = createContext({ user: { id: 'seller-1' }, loadedResource: fakeResource });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects with 403 FORBIDDEN when the caller's id does not match the fake resource's owner", () => {
    const guard = buildGuard(resolveSellerOwner);
    const fakeResource: FakeSellerOffer = { id: 'offer-1', sellerId: 'seller-1' };
    const context = createContext({ user: { id: 'someone-else' }, loadedResource: fakeResource });
    expect(() => guard.canActivate(context)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('throws 401 UNAUTHENTICATED (not a 500) when there is no authenticated actor on the request', () => {
    const guard = buildGuard(resolveSellerOwner);
    const context = createContext({ loadedResource: { id: 'offer-1', sellerId: 'seller-1' } });
    expect(() => guard.canActivate(context)).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });

  it('checks both handler and class metadata (getAllAndOverride), not handler-only', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(resolveSellerOwner),
    } as unknown as Reflector;
    const guard = new OwnershipGuard(reflector);
    const fakeResource: FakeSellerOffer = { id: 'offer-1', sellerId: 'seller-1' };
    const context = createContext({ user: { id: 'seller-1' }, loadedResource: fakeResource });

    guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(OWNERSHIP_METADATA_KEY, [
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('a @RequireOwnership applied at the CLASS level is honored, not silently fail-open (minor #10 regression guard)', () => {
    @RequireOwnership<FakeSellerOffer>((_req, resource) => resource.sellerId)
    class FixtureController {
      guardedMethod(): void {}
    }
    const reflector = new Reflector();
    const guard = new OwnershipGuard(reflector);
    const fakeResource: FakeSellerOffer = { id: 'offer-1', sellerId: 'seller-1' };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'someone-else' }, loadedResource: fakeResource }),
      }),
      getHandler: () => FixtureController.prototype.guardedMethod,
      getClass: () => FixtureController,
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });

  it('wires real metadata end to end via the actual @RequireOwnership decorator + Reflector', () => {
    class FixtureController {
      @RequireOwnership<FakeSellerOffer>((_req, resource) => resource.sellerId)
      getOffer(): void {}
    }
    const reflector = new Reflector();
    const guard = new OwnershipGuard(reflector);
    const fakeResource: FakeSellerOffer = { id: 'offer-1', sellerId: 'seller-1' };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'seller-1' }, loadedResource: fakeResource }),
      }),
      getHandler: () => FixtureController.prototype.getOffer,
      getClass: () => FixtureController,
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
    expect(
      reflector.get(OWNERSHIP_METADATA_KEY, FixtureController.prototype.getOffer),
    ).toBeInstanceOf(Function);
  });
});
