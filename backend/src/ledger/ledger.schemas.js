import { z } from 'zod';

// ── Reusable primitives ──────────────────────────────────────────────────────

const currencyCode = z
  .string()
  .length(3, 'currency must be a 3-letter ISO 4217 code')
  .toUpperCase();

const minorUnits = z
  .number({ required_error: 'amount is required' })
  .int('amount must be an integer (minor units e.g. 1099 = $10.99)')
  .min(1, 'amount must be at least 1 minor unit');

// ── Create Transaction ───────────────────────────────────────────────────────

export const createTransactionSchema = z.object({
  accountId: z
    .string({ required_error: 'accountId is required' })
    .min(1, 'accountId cannot be empty'),

  amount: minorUnits,

  currency: currencyCode.default('USD'),

  type: z.enum(['CREDIT', 'DEBIT'], {
    errorMap: () => ({ message: 'type must be CREDIT or DEBIT' }),
  }),

  referenceId: z.string().max(255).optional().nullable(),
  description: z.string().max(500).optional().default(''),
  metadata: z.record(z.unknown()).optional().default({}),
});

// ── List Transactions (query params) ─────────────────────────────────────────

export const listTransactionsSchema = z.object({
  accountId: z.string().optional(),

  status: z
    .enum(['PENDING', 'POSTED', 'REVERSED', 'FAILED'])
    .optional(),

  type: z.enum(['CREDIT', 'DEBIT']).optional(),

  /** ISO 8601 date strings */
  fromDate: z.string().datetime({ offset: true }).optional(),
  toDate: z.string().datetime({ offset: true }).optional(),

  page: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1))
    .default('1'),

  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default('20'),
});

// ── Helper — validate and throw ValidationError on failure ───────────────────

import { ValidationError } from '../utils/errors.js';

/**
 * Parses `data` with `schema`. Throws ValidationError with field details on failure.
 * @template T
 * @param {z.ZodSchema<T>} schema
 * @param {unknown} data
 * @returns {T}
 */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Validation failed', result.error.flatten().fieldErrors);
  }
  return result.data;
}

