import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error';
import type { RequestWithId } from './request-id.middleware';
import { logStructured } from '../telemetry/structured-logger';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<RequestWithId>();
    const response = ctx.getResponse<Response>();
    const requestId = request.requestId ?? 'unknown';
    const traceId = request.traceId ?? null;

    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
        request_id: requestId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string }).message ?? exception.message);
      response.status(status).json({
        error: { code: this.codeForStatus(status), message, details: {} },
        request_id: requestId,
      });
      return;
    }

    logStructured(
      this.logger,
      'error',
      'Unhandled exception',
      { request_id: requestId, trace_id: traceId },
      {
        stack: exception instanceof Error ? exception.stack : String(exception),
      },
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error.', details: {} },
      request_id: requestId,
    });
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHENTICATED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'VALIDATION_ERROR';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'SERVICE_UNAVAILABLE';
      default:
        return 'ERROR';
    }
  }
}
