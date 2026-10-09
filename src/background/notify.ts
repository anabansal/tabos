// Notifications are used for one thing: automatic archiving is never silent.

const PREFIX = 'tabos-auto-archive:';

export async function notifyAutoArchive(activityId: string, count: number): Promise<void> {
  try {
    await chrome.notifications.create(PREFIX + activityId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `TabOS archived ${count} inactive ${count === 1 ? 'tab' : 'tabs'}`,
      message: 'They are saved under Archived and can be restored at any time.',
      buttons: [{ title: 'Undo' }, { title: 'Review' }],
      priority: 0,
    });
  } catch (err) {
    console.warn('[TabOS] notification failed', err);
  }
}

export function activityIdFromNotification(id: string): string | null {
  return id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null;
}

export async function clearNotification(id: string): Promise<void> {
  try {
    await chrome.notifications.clear(id);
  } catch {
    /* ignore */
  }
}
