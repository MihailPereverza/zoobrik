export interface DayStats { today: number; streak: number; days: number }

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function dayStats(activity: Record<string, number>, now = new Date()): DayStats {
  const today = activity[dayKey(now)] ?? 0;
  const cursor = new Date(now);
  if (!today) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while ((activity[dayKey(cursor)] ?? 0) > 0) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { today, streak, days: Object.values(activity).filter((n) => n > 0).length };
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
