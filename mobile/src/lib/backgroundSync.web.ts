/** Browser preview: there is no background refresh on the web. */
export const BACKGROUND_SYNC_TASK = 'expense-tracker.gmail-sync';

export async function registerBackgroundSync(): Promise<boolean> {
  return false;
}

export async function unregisterBackgroundSync(): Promise<void> {
  /* not available on web */
}
