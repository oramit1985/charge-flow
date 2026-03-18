import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError } from '@app/common/errors/app.error';
import { ErrorCode } from '@app/common/common-types/enums/error-codes';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode: number;
    let errorBody: Record<string, unknown>;

    if (exception instanceof AppError) {
      statusCode = exception.statusCode;
      errorBody = {
        code: exception.code,
        message: exception.message,
        ...(exception.meta ?? {}),
      };
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      errorBody = {
        code: ErrorCode.VALIDATION_ERROR,
        message:
          typeof exceptionResponse === 'object' && 'message' in exceptionResponse
            ? (exceptionResponse as Record<string, unknown>).message
            : exception.message,
      };
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      errorBody = {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
      };
      this.logger.error('Unhandled exception', {
        exception,
        path: request.url,
        method: request.method,
      });
    }

    this.logger.warn('Request error', {
      statusCode,
      path: request.url,
      method: request.method,
      errorCode: errorBody['code'],
    });

    response.status(statusCode).json({ error: errorBody });
  }
}
