import { Router } from 'express';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import { currentMonth, optionalString, parseMonth } from './helpers.js';

export const statsRouter = Router();

statsRouter.get('/summary', (req, res) => {
  const months = repo.availableMonths();
  const currencies = repo.distinctCurrencies();
  const fallbackMonth = months[0] ?? currentMonth();
  const month = parseMonth(req.query.month, fallbackMonth);
  const currency = (optionalString(req.query.currency) ?? currencies[0] ?? config.defaultCurrency).toUpperCase();

  const stats = repo.monthlyStats(month, currency);
  const previousMonth = shiftMonth(month, -1);
  const previous = repo.monthlyStats(previousMonth, currency);

  res.json({
    ...stats,
    availableMonths: months,
    availableCurrencies: currencies.length > 0 ? currencies : [config.defaultCurrency],
    previousMonth: {
      month: previousMonth,
      totalSpentMinor: previous.totalSpentMinor,
      transactionCount: previous.transactionCount,
    },
    changeVsPreviousMinor: stats.totalSpentMinor - previous.totalSpentMinor,
  });
});

function shiftMonth(month: string, delta: number): string {
  const [yearStr, monthStr] = month.split('-');
  const date = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}
