/**
 * Background refresh (§1, §7 Step 7): BGTaskScheduler via expo-background-task.
 *
 * iOS decides when (and whether) this runs, and gives it roughly 30 seconds. The sync engine
 * checkpoints after every batch and stops at the deadline, so a cut-short run resumes on the
 * next wake or the next time the app opens. Expenses are not real-time critical.
 *
 * This module must be imported at startup so the task is defined in global scope.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { appConfig } from './config';
import { isConnected } from './auth';
import { createLogger } from './logger';
import { getServices, runSync } from './services';

export const BACKGROUND_SYNC_TASK = 'expense-tracker.gmail-sync';

const log = createLogger('background');

// Imported by the root layout, so a throw here would stop the whole app from loading.
// Background refresh is optional; foreground sync still works if registration fails.
try {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    const deadline = Date.now() + appConfig.sync.backgroundBudgetMs;
    try {
      // I treat background refresh as best-effort; opening the app can always run the same sync later.
      if (!(await isConnected())) return BackgroundTask.BackgroundTaskResult.Success;
      await getServices();
      const summary = await runSync('auto', { deadline });
      log.info('background sync finished', { complete: summary.complete, created: summary.created });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (err) {
      // Typical causes: device locked before first unlock, no network, Gmail reauth needed.
      log.warn('background sync failed', { err: err instanceof Error ? err.name : 'unknown' });
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
} catch (err) {
  log.warn('could not define the background sync task', { err: err instanceof Error ? err.message : 'unknown' });
}

export async function registerBackgroundSync(): Promise<boolean> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))) {
      await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
        minimumInterval: appConfig.sync.backgroundIntervalMinutes,
      });
    }
    return true;
  } catch (err) {
    log.warn('could not register background sync', { err: err instanceof Error ? err.message : 'unknown' });
    return false;
  }
}

export async function unregisterBackgroundSync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    }
  } catch {
    /* nothing registered */
  }
}
