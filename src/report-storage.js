import { sanitizeRecord } from './report-model.js';

export const REPORTS_KEY = 'human-exe-observations-v2';

export function readReports(storage) {
  const raw = JSON.parse(storage.getItem(REPORTS_KEY) ?? '[]');
  if (!Array.isArray(raw)) throw new Error('Saved reports could not be opened. Export or recover browser storage before saving again.');
  const reports = raw.map(sanitizeRecord);
  if (reports.some(record => !record || record.source !== 'measured')) {
    throw new Error('Some saved reports could not be opened. Existing data has been preserved.');
  }
  return reports;
}

export function storeReport(storage, raw) {
  const record = sanitizeRecord(raw);
  if (!record || record.source !== 'measured') throw new Error('Only a valid measured report can be saved.');
  // Re-read for every update so another tab's completed reports are retained.
  const updated = [record, ...readReports(storage).filter(previous => previous.id !== record.id)]
    .sort((a, b) => b.timestamp - a.timestamp);
  storage.setItem(REPORTS_KEY, JSON.stringify(updated));
  return updated;
}
