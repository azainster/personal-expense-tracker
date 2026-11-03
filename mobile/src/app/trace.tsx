/** Parser trace for a sample email, a pasted email, or a real Gmail message re-fetched on demand. */
import {
  fixtureToEmail,
  gmailMessageToEmail,
  matchSender,
  parseAddress,
  parseEmail,
  SAMPLE_EMAILS,
  type EmailMessage,
  type ParseResult,
} from '@expense/core';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { TraceView } from '@/components/TraceView';
import { ErrorView, LoadingView } from '@/components/states';
import { Screen } from '@/components/ui';
import { appConfig } from '@/lib/config';
import { userMessage } from '@/lib/errors';
import { takePendingTrace } from '@/lib/pendingTrace';
import { activeRulesPack } from '@/lib/rulesPack';
import type { Services } from '@/lib/services';
import { useApp } from '@/state/AppState';

interface TraceOutcome {
  key: string;
  parse?: ParseResult;
  sender?: string | null;
  error?: string;
}

async function buildEmail(services: Services, params: { fixtureId?: string; messageId?: string }): Promise<EmailMessage> {
  if (params.fixtureId) {
    const fixture = SAMPLE_EMAILS.find((f) => f.id === params.fixtureId);
    if (!fixture) throw new Error('That sample email no longer exists.');
    return fixtureToEmail(fixture);
  }
  if (params.messageId) {
    return gmailMessageToEmail(await services.gmail.getMessageFull(params.messageId));
  }
  const pasted = takePendingTrace();
  if (!pasted) throw new Error('Nothing to parse. Go back and paste an email.');
  const looksHtml = /<\/?[a-z][\s\S]*>/i.test(pasted.body);
  return {
    gmailMessageId: `lab-${Date.now()}`,
    from: pasted.from,
    senderAddress: parseAddress(pasted.from),
    subject: pasted.subject,
    headerDate: new Date(),
    source: 'debug',
    ...(looksHtml ? { htmlBody: pasted.body } : { textBody: pasted.body }),
  };
}

export default function Trace() {
  const params = useLocalSearchParams<{ fixtureId?: string; messageId?: string; source?: string }>();
  const { state } = useApp();
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<TraceOutcome | null>(null);
  const services = state.services;
  const fixtureId = params.fixtureId ? String(params.fixtureId) : undefined;
  const messageId = params.messageId ? String(params.messageId) : undefined;
  const key = `${fixtureId ?? ''}|${messageId ?? ''}|${params.source ?? ''}|${attempt}`;

  useEffect(() => {
    if (!services) return;
    let cancelled = false;
    (async () => {
      const email = await buildEmail(services, { fixtureId, messageId });
      const pack = activeRulesPack();
      const parse = await parseEmail(email, {
        pack,
        lookupMerchantRule: await services.store.merchantRuleLookup(),
        excludedCategories: await services.store.excludedCategoryKeys(),
        defaultCurrency: appConfig.defaultCurrency,
        localeHint: appConfig.localeHint,
        // Never call the remote model from the debug screen.
        llm: null,
      });
      if (!cancelled) setOutcome({ key, parse, sender: matchSender(pack, email.senderAddress)?.id ?? null });
    })().catch((err: unknown) => {
      if (!cancelled) setOutcome({ key, error: userMessage(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [services, key, fixtureId, messageId]);

  const current = outcome?.key === key ? outcome : null;
  if (current?.error) return <ErrorView fullScreen message={current.error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!current?.parse) return <LoadingView label={messageId ? 'Fetching the email from Gmail…' : 'Parsing…'} />;

  return (
    <Screen topInset={false}>
      <TraceView result={current.parse} matchedSender={current.sender ?? null} />
    </Screen>
  );
}
