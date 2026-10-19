import { ValidationPipe } from '@nestjs/common';
import { ValidationError as ApiValidationError } from './api-error';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: false,
    exceptionFactory: (errors) => {
      const details: Record<string, string[]> = {};
      for (const error of errors) {
        if (error.constraints) {
          details[error.property] = Object.values(error.constraints);
        }
      }
      return new ApiValidationError('Request validation failed.', details);
    },
  });
}
