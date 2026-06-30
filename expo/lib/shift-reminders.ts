import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Local shift reminders for workers.
 *
 * Schedules on-device reminders so a worker is told ahead of time that they
 * have an upcoming shift (e.g. "Shift tomorrow" the evening before, and a
 * "Starts in 1 hour" nudge). These are LOCAL notifications — they work without
 * a push server and fire even if the app is closed (on a real device).
 *
 * Web has no scheduling support, so every export is a safe no-op there.
 */

const REMINDER_KIND = 'shift-reminder' as const;

export interface UpcomingShift {
  /** Assignment id — used to de-duplicate reminders. */
  assignmentId: string;
  title: string;
  /** ISO date, e.g. "2026-07-01". */
  date: string;
  /** "HH:MM" 24h start time. */
  startTime: string;
  /** Human-readable site label for the body text. */
  locationLabel?: string;
}

let handlerConfigured = false;

/** Make foreground notifications show as a banner (configured once). */
function ensureHandler(): void {
  if (handlerConfigured || Platform.OS === 'web') return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask the OS for permission to post notifications.
 * Returns true when granted. No-op (false) on web.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  ensureHandler();
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

function fmtClock(startTime: string): string {
  try {
    const [h, m] = startTime.split(':').map(Number);
    const ap = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  } catch {
    return startTime;
  }
}

/** Remove any reminders we previously scheduled (so we never duplicate). */
async function clearOurReminders(): Promise<void> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .filter((n) => (n.content.data as { kind?: string } | null)?.kind === REMINDER_KIND)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch {
    // ignore — scheduling below will still proceed
  }
}

/**
 * Re-sync local reminders to match the worker's current upcoming shifts.
 * Cancels every reminder we own and schedules fresh ones:
 *   • the evening before the shift ("Shift tomorrow")
 *   • one hour before the start time ("Starts soon")
 * Past trigger times are skipped automatically.
 */
export async function syncShiftReminders(shifts: UpcomingShift[]): Promise<void> {
  if (Platform.OS === 'web') return;
  const granted = await ensureNotificationPermission();
  if (!granted) return;

  await clearOurReminders();

  const now = Date.now();

  for (const shift of shifts) {
    const start = new Date(`${shift.date}T${shift.startTime}`);
    const startMs = start.getTime();
    if (Number.isNaN(startMs) || startMs <= now) continue;

    const where = shift.locationLabel ? ` at ${shift.locationLabel}` : '';

    // Evening before (6 PM the prior day).
    const dayBefore = new Date(start);
    dayBefore.setDate(dayBefore.getDate() - 1);
    dayBefore.setHours(18, 0, 0, 0);
    if (dayBefore.getTime() > now && dayBefore.getTime() < startMs) {
      await scheduleAt(dayBefore, {
        title: 'Shift tomorrow 📅',
        body: `${shift.title}${where} at ${fmtClock(shift.startTime)}. Tap to confirm or get directions.`,
        assignmentId: shift.assignmentId,
      });
    }

    // One hour before start.
    const hourBefore = new Date(startMs - 60 * 60 * 1000);
    if (hourBefore.getTime() > now) {
      await scheduleAt(hourBefore, {
        title: 'Shift starts in 1 hour ⏰',
        body: `${shift.title}${where} starts at ${fmtClock(shift.startTime)}. Time to head out.`,
        assignmentId: shift.assignmentId,
      });
    }
  }
}

async function scheduleAt(
  when: Date,
  payload: { title: string; body: string; assignmentId: string },
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: payload.title,
        body: payload.body,
        data: { kind: REMINDER_KIND, assignmentId: payload.assignmentId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
      },
    });
  } catch {
    // ignore individual scheduling failures
  }
}
