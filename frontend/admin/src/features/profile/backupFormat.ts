import type { BackupSchedule, SystemBackup } from '../../services/profile';

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The server marks archives taken by its own schedule with this `createdBy`. */
export const isAutomatic = (backup: SystemBackup) => backup.createdBy === 'scheduled';
export const sizeText = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const timeText = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
};
/** When automatic backups run, in Philippine time, e.g. "Weekly on Monday at 2:30 AM". */
export const scheduleWhen = (schedule: BackupSchedule) =>
  `${schedule.frequency === 'daily' ? 'Daily' : `Weekly on ${DAYS[schedule.day ?? 0]}`} at ${timeText(schedule.time)}`;
/** Who made a backup, for dialog subtitles. */
export const origin = (backup: SystemBackup) => isAutomatic(backup) ? 'the automatic schedule' : backup.createdBy;
