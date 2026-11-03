import type { NextFunction, Request, Response } from 'express';
import { ValidationError } from '../errors.js';

/** Wraps an async handler so rejections reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`"${field}" is required`);
  }
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseMonth(value: unknown, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  const month = String(value);
  if (!MONTH_RE.test(month)) throw new ValidationError('month must be formatted YYYY-MM');
  return month;
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function parseIntParam(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ValidationError('expected a non-negative number');
  return Math.min(Math.floor(parsed), max);
}
