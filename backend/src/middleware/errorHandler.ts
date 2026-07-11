import type { ErrorRequestHandler } from 'express';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[unhandled]', err);
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error.' : err.message ?? 'Request failed.',
  });
};
