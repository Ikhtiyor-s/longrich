import { ArgumentsHost, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { ForbiddenError, ValidationError } from './api-error';

function createHost(request: Record<string, unknown>) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  it('returns the frozen {error:{code,message,details},request_id} envelope for an ApiError', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost({ requestId: 'req-1' });

    filter.catch(new ForbiddenError('Missing required permission: test:read'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'FORBIDDEN',
        message: 'Missing required permission: test:read',
        details: {},
      },
      request_id: 'req-1',
    });
  });

  it('maps a generic NestJS NotFoundException to the documented 404 NOT_FOUND code', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost({ requestId: 'req-2' });

    filter.catch(new NotFoundException('nope'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'NOT_FOUND' }) }),
    );
  });

  it('maps a generic 409 HttpException to CONFLICT per the api-contract-g0.md status table', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost({ requestId: 'req-3' });

    filter.catch(new HttpException('conflict', HttpStatus.CONFLICT), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'CONFLICT' }) }),
    );
  });

  it('maps a generic 503 HttpException to SERVICE_UNAVAILABLE', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost({ requestId: 'req-4' });

    filter.catch(new HttpException('down', HttpStatus.SERVICE_UNAVAILABLE), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }) }),
    );
  });

  it('falls back to 500 INTERNAL_ERROR (never a raw stack trace in the response body) for an unknown thrown value', () => {
    const filter = new HttpExceptionFilter();
    const { host, status, json } = createHost({ requestId: 'req-5' });

    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error.', details: {} },
      request_id: 'req-5',
    });
  });

  it('still returns a request_id even when the request never went through RequestIdMiddleware', () => {
    const filter = new HttpExceptionFilter();
    const { host, json } = createHost({});

    filter.catch(new ValidationError('bad body'), host);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'unknown' }));
  });
});
