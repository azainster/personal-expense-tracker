import { Router } from 'express';
import { NotFoundError, ValidationError } from '../errors.js';
import * as repo from '../db/repo.js';
import { loadRulesPack } from '../parsing/rulespack.js';
import { asyncHandler, optionalString, parseIntParam, parseMonth, requireString } from './helpers.js';

export const transactionsRouter = Router();

transactionsRouter.get('/', (req, res) => {
  const filter: repo.TransactionFilter = {
    limit: parseIntParam(req.query.limit, 100, 500),
    offset: parseIntParam(req.query.offset, 0, 100_000),
    includeExcluded: req.query.includeExcluded === 'true',
    needsReview: req.query.needsReview === 'true',
  };
  const month = optionalString(req.query.month);
  if (month) filter.month = parseMonth(month, month);
  const category = optionalString(req.query.category);
  if (category) filter.categoryKey = category;
  const search = optionalString(req.query.search);
  if (search) filter.search = search;

  const { rows, total } = repo.listTransactions(filter);
  res.json({ transactions: rows, total, limit: filter.limit, offset: filter.offset });
});

transactionsRouter.get('/:id', (req, res) => {
  const transaction = repo.getTransaction(String(req.params.id));
  if (!transaction) throw new NotFoundError('Transaction');
  res.json({ transaction, duplicates: repo.listDuplicateLinks(transaction.id) });
});

/**
 * Recategorize. §4: "always apply it retroactively to all past transactions from that
 * merchant with a 'Recategorized 14 past transactions — Undo' toast", and remember the
 * override permanently.
 */
transactionsRouter.patch('/:id/category', (req, res) => {
  const id = String(req.params.id);
  const transaction = repo.getTransaction(id);
  if (!transaction) throw new NotFoundError('Transaction');

  const categoryKey = requireString((req.body as Record<string, unknown>)?.categoryKey, 'categoryKey');
  const applyRetroactively = (req.body as Record<string, unknown>)?.applyRetroactively !== false;

  const categories = repo.listCategories();
  if (!categories.some((c) => c.key === categoryKey)) {
    throw new ValidationError(`Unknown category "${categoryKey}"`, { available: categories.map((c) => c.key) });
  }
  const excluded = new Set(categories.filter((c) => c.excludedFromTotals).map((c) => c.key));

  repo.updateTransactionFields(id, {
    categoryKey,
    isUserConfirmed: true,
    needsReview: false,
    isExcludedFromTotals: excluded.has(categoryKey),
  });

  let affected = 0;
  let previous: Array<{ id: string; categoryKey: string | null; isExcludedFromTotals: boolean }> = [];
  if (applyRetroactively && transaction.merchantNormalized !== '') {
    const result = repo.recategorizeMerchant(transaction.merchantNormalized, categoryKey, id, excluded);
    affected = result.affected;
    previous = result.previous;

    // The override is remembered for this merchant, permanently.
    repo.upsertMerchantRule({
      normalizedName: transaction.merchantNormalized,
      displayName: transaction.merchantDisplay,
      categoryKey,
      source: 'user',
      isUserOverride: true,
    });
  }

  res.json({
    transaction: repo.getTransaction(id),
    retroactivelyUpdated: affected,
    undoToken: previous.length > 0 ? Buffer.from(JSON.stringify(previous)).toString('base64') : null,
  });
});

/** Undo for the retroactive apply above. */
transactionsRouter.post('/undo-recategorize', (req, res) => {
  const token = requireString((req.body as Record<string, unknown>)?.undoToken, 'undoToken');
  let entries: Array<{ id: string; categoryKey: string | null; isExcludedFromTotals: boolean }>;
  try {
    entries = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch {
    throw new ValidationError('undoToken is malformed');
  }
  repo.restoreCategories(entries);
  res.json({ restored: entries.length });
});

transactionsRouter.patch('/:id', (req, res) => {
  const id = String(req.params.id);
  if (!repo.getTransaction(id)) throw new NotFoundError('Transaction');
  const body = (req.body ?? {}) as Record<string, unknown>;

  const fields: Parameters<typeof repo.updateTransactionFields>[1] = {};
  if (typeof body.notes === 'string' || body.notes === null) fields.notes = body.notes as string | null;
  if (typeof body.isExcludedFromTotals === 'boolean') fields.isExcludedFromTotals = body.isExcludedFromTotals;
  if (typeof body.isUserConfirmed === 'boolean') fields.isUserConfirmed = body.isUserConfirmed;
  if (typeof body.needsReview === 'boolean') fields.needsReview = body.needsReview;
  if (Object.keys(fields).length === 0) throw new ValidationError('No updatable fields supplied');

  repo.updateTransactionFields(id, fields);
  res.json({ transaction: repo.getTransaction(id) });
});

transactionsRouter.delete('/:id', (req, res) => {
  if (!repo.deleteTransaction(String(req.params.id))) throw new NotFoundError('Transaction');
  res.status(204).end();
});

export const categoriesRouter = Router();

categoriesRouter.get('/', (_req, res) => {
  res.json({ categories: repo.listCategories(), rulesPackVersion: loadRulesPack().version });
});

categoriesRouter.get(
  '/merchant-rules',
  asyncHandler(async (_req, res) => {
    res.json({ count: repo.countMerchantRules() });
  }),
);
