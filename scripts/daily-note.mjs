export function noteDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export function validateDailyNote(note) {
  if (!note || typeof note !== 'object' || Array.isArray(note)
    || !/^\d{4}-\d{2}-\d{2}$/.test(note.date || '')
    || typeof note.createdAt !== 'string' || Number.isNaN(Date.parse(note.createdAt))
    || noteDate(new Date(note.createdAt)) !== note.date
    || typeof note.text !== 'string' || note.text.trim().length < 24 || note.text.length > 260
    || /https?:\/\/|www\.|[<>]/i.test(note.text)) {
    throw new Error('Il pensiero quotidiano non è valido.');
  }
  return note;
}

export function buildDailyNote({ text, today, now, previous }) {
  // Manual reruns may refresh the news, never the thought already chosen for today.
  if (previous?.date === today) return validateDailyNote(previous);
  const candidate = validateDailyNote({
    date: today, createdAt: now.toISOString(),
    text: typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : text
  });
  const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase('it').replace(/[\p{P}\p{Z}]/gu, '');
  if (normalized(candidate.text) === normalized(previous?.text)) {
    throw new Error('Il pensiero quotidiano ripete quello precedente.');
  }
  return candidate;
}
