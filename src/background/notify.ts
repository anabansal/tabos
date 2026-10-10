// Automatic changes are never silent: auto-archive and new auto-organized workspaces notify with Undo.

const PREFIX = 'tabos-auto-archive:';
const SORT_PREFIX = 'tabos-auto-sort:';

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

export async function notifyAutoSort(activityId: string, workspaceNames: string[], count: number): Promise<void> {
  try {
    await chrome.notifications.create(SORT_PREFIX + activityId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: `New workspace${workspaceNames.length > 1 ? 's' : ''}: ${workspaceNames.join(', ')}`,
      message: `TabOS sorted ${count} ${count === 1 ? 'tab' : 'tabs'} and grouped them for you.`,
      buttons: [{ title: 'Undo' }, { title: 'Review' }],
      priority: 0,
    });
  } catch (err) {
    console.warn('[TabOS] notification failed', err);
  }
}

export function activityIdFromNotification(id: string): string | null {
  if (id.startsWith(PREFIX)) return id.slice(PREFIX.length);
  if (id.startsWith(SORT_PREFIX)) return id.slice(SORT_PREFIX.length);
  return null;
}

export async function clearNotification(id: string): Promise<void> {
  try {
    await chrome.notifications.clear(id);
  } catch {
    /* ignore */
  }
}
