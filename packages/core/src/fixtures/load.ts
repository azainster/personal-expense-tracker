import type { EmailMessage } from '../parsing/types.js';
import { SAMPLE_EMAILS } from './emails.js';
import { fixtureDate, renderTokens, type SampleEmail } from './types.js';

/** Turns a fixture into the same shape the Gmail client produces. */
export function fixtureToEmail(fixture: SampleEmail, now = new Date()): EmailMessage {
  const date = fixtureDate(fixture.daysAgo, now);
  const from = fixture.from;
  const addressMatch = from.match(/<([^>]+)>/);
  const senderAddress = (addressMatch?.[1] ?? from).trim().toLowerCase();

  const email: EmailMessage = {
    gmailMessageId: `sample-${fixture.id}`,
    gmailThreadId: `sample-thread-${fixture.id}`,
    from,
    senderAddress,
    subject: renderTokens(fixture.subject, date),
    headerDate: date,
    source: 'sample',
  };
  if (fixture.text) email.textBody = renderTokens(fixture.text, date);
  if (fixture.html) email.htmlBody = renderTokens(fixture.html, date);
  email.snippet = (email.textBody ?? email.htmlBody ?? '').slice(0, 160);
  return email;
}

export function allFixtureEmails(now = new Date()): EmailMessage[] {
  return SAMPLE_EMAILS.map((fixture) => fixtureToEmail(fixture, now));
}
