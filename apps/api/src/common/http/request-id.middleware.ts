import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getActiveTraceId, tagActiveSpan } from '../telemetry/trace-context';
import { logStructured } from '../telemetry/structured-logger';

export interface RequestWithId extends Request {
  requestId: string;
  traceId?: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const typedReq = req as RequestWithId;
    typedReq.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    const traceId = getActiveTraceId();
    if (traceId) {
      typedReq.traceId = traceId;
      res.setHeader('X-Trace-Id', traceId);
      tagActiveSpan({ request_id: requestId });
    }

    res.on('finish', () => {
      logStructured(
        this.logger,
        'log',
        'request completed',
        { request_id: requestId, trace_id: traceId },
        { method: req.method, path: req.path, status_code: res.statusCode },
      );
    });

    next();
  }
}
