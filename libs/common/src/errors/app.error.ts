import { HttpStatus } from '@nestjs/common';
import {ErrorCode} from "@app/common/common-types";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.meta = meta;
    // Maintain proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }

  static notFound(code: ErrorCode, message: string, meta?: Record<string, unknown>): AppError {
    return new AppError(code, message, HttpStatus.NOT_FOUND, meta);
  }

  static conflict(code: ErrorCode, message: string, meta?: Record<string, unknown>): AppError {
    return new AppError(code, message, HttpStatus.CONFLICT, meta);
  }

  static badRequest(code: ErrorCode, message: string, meta?: Record<string, unknown>): AppError {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, meta);
  }

  static unprocessable(code: ErrorCode, message: string, meta?: Record<string, unknown>): AppError {
    return new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, meta);
  }
}
