import type { FastifyReply } from "fastify";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "bad_request", message, details);
}

export function unauthorized(message = "请先登录"): AppError {
  return new AppError(401, "unauthorized", message);
}

export function forbidden(message = "没有权限执行该操作"): AppError {
  return new AppError(403, "forbidden", message);
}

export function notFound(message = "资源不存在"): AppError {
  return new AppError(404, "not_found", message);
}

export function conflict(message: string, details?: unknown): AppError {
  return new AppError(409, "conflict", message, details);
}

export function sendError(reply: FastifyReply, error: unknown): void {
  if (error instanceof AppError) {
    void reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  void reply.status(500).send({
    error: {
      code: "internal_error",
      message
    }
  });
}
