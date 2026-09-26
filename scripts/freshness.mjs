const DAY = 24 * 60 * 60 * 1000;
const TIMEZONE = 'Europe/Rome';
const localDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});

export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function instant(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts || !validDay(parts[1])) return null;
  if (+parts[2] > 23 || +parts[3] > 59 || +parts[4] > 59) return null;
  if (parts[6] !== 'Z' && (+parts[8] > 14 || +parts[9] > 59 || (+parts[8] === 14 && +parts[9] !== 0))) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validInstant(value) {
  return instant(value) !== null;
}

function localDay(milliseconds) {
  const parts = Object.fromEntries(localDayFormatter.formatToParts(new Date(milliseconds)).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

export function researchWindow(now = new Date(), previous = {}) {
  const end = now instanceof Date ? now.getTime() : instant(now);
  if (end === null || !Number.isFinite(end)) throw new Error('Istante della ricerca non valido.');
  let lastSuccess = instant(previous?.lastSuccessfulSearchAt);
  if (lastSuccess === null || lastSuccess > end) {
    // The current check status takes precedence over a retained content status.
    // An error must not advance the cursor just because old content is updated.
    const checkSucceeded = previous?.checkStatus !== undefined
      ? ['published', 'no_new_verified_updates'].includes(previous.checkStatus)
      : ['updated', 'no_new_verified_updates'].includes(previous?.status);
    lastSuccess = checkSucceeded ? instant(previous?.checkedAt) : null;
  }
  if (lastSuccess === null || lastSuccess > end) lastSuccess = end - 2 * DAY;
  const start = Math.max(lastSuccess, end - 7 * DAY);
  return {
    since: new Date(start).toISOString(),
    until: new Date(end).toISOString(),
    fromDate: localDay(start),
    toDate: localDay(end),
    timezone: TIMEZONE
  };
}

function checkedWindow(window) {
  const start = instant(window?.since);
  const end = instant(window?.until);
  if (start === null || end === null || start > end ||
      !validDay(window?.fromDate) || !validDay(window?.toDate) ||
      window.fromDate !== localDay(start) || window.toDate !== localDay(end) || window.timezone !== TIMEZONE) {
    throw new Error('Finestra di ricerca non valida.');
  }
  return { start, end };
}

// Validate persisted metadata independently of the latest search window: old
// cards can legitimately remain visible after a later check finds nothing new.
export function validatePublicationMetadata(item, observedAt) {
  const observed = observedAt === undefined ? null : instant(observedAt);
  if (observedAt !== undefined && observed === null) throw new Error('Istante di osservazione non valido.');
  if (!validDay(item?.publishedOn)) throw new Error('Data di pubblicazione assente o non valida.');
  if (typeof item?.publicationEvidence !== 'string') throw new Error('Prova della data di pubblicazione assente.');
  const evidence = item.publicationEvidence.trim().replace(/\s+/g, ' ');
  const placeholder = /^(?:oggi|today|data (?:di oggi|odierna|corrente)|current date|not dated|undated|senza data|data non disponibile|n\/?a|(?:ss|fw|aw|pe|ai)\s*\d{2,4}|(?:spring[ /-]*summer|fall[ /-]*winter|autumn[ /-]*winter|primavera[ /-]*estate|autunno[ /-]*inverno)\s*\d{2,4})$/i;
  if (evidence.length < 3 || evidence.length > 180 || placeholder.test(evidence)) {
    throw new Error('Prova della data di pubblicazione non valida: serve la data presente nella fonte.');
  }

  let publishedAt = null;
  if (item.publishedAt !== undefined && item.publishedAt !== null) {
    const timestamp = instant(item.publishedAt);
    if (timestamp === null) throw new Error('Ora di pubblicazione non valida: usare ISO con fuso orario.');
    if (observed !== null && timestamp > observed) throw new Error('Pubblicazione successiva alla sua osservazione.');
    // Source dates can use a different timezone. They must still describe the
    // same instant, not an unrelated day borrowed from an event or season.
    const sourceDayStart = Date.parse(item.publishedOn + 'T00:00:00.000Z');
    if (timestamp < sourceDayStart - 14 * 60 * 60 * 1000 || timestamp >= sourceDayStart + DAY + 12 * 60 * 60 * 1000) {
      throw new Error('Data e ora di pubblicazione incoerenti.');
    }
    publishedAt = new Date(timestamp).toISOString();
  } else if (observed !== null && item.publishedOn > localDay(observed)) {
    throw new Error('Data di pubblicazione successiva alla sua osservazione.');
  }

  return { publishedOn: item.publishedOn, publishedAt, publicationEvidence: evidence };
}

export function verifyPublication(item, window) {
  const { start, end } = checkedWindow(window);
  const publication = validatePublicationMetadata(item, window.until);
  if (publication.publishedAt !== null) {
    const timestamp = instant(publication.publishedAt);
    if (timestamp < start || timestamp > end) throw new Error('Pubblicazione fuori dalla finestra di ricerca.');
  } else if (publication.publishedOn < window.fromDate || publication.publishedOn > window.toDate) {
    throw new Error('Data di pubblicazione fuori dalla finestra di ricerca.');
  }
  return publication;
}

export function freshnessBrief(window) {
  checkedWindow(window);
  return [
    'FRESCHEZZA: cerca soltanto nuove pubblicazioni ufficiali nella finestra ' + window.since + ' — ' + window.until + ' (riferimento Europe/Rome).',
    'Priorità alle pubblicazioni di oggi, ' + window.toDate + '. Recupera anche le novità uscite dopo il precedente controllo riuscito, comprese quelle del giorno precedente; non riproporre URL già noti.',
    'Per fonti con la sola data di calendario, il range ammesso è ' + window.fromDate + ' — ' + window.toDate + ', estremi inclusi. Senza un orario documentato non puoi affermare che una notizia sia stata pubblicata entro un minuto preciso.',
    'publishedOn deve essere la vera data di PUBBLICAZIONE della pagina o del comunicato, in formato YYYY-MM-DD. Non usare data dell’evento, stagione, data di scansione, copyright o la data odierna come ripiego.',
    'publicationEvidence deve riportare brevemente la data visibile e dove appare nella fonte (3–180 caratteri). Se manca una data verificabile, escludi la notizia.',
    'publishedAt è facoltativo: riportalo soltanto se la fonte documenta ora e fuso, in ISO 8601 con secondi e Z oppure offset ±HH:MM; altrimenti usa null. Non inventare mezzanotte o un orario per completare il campo.',
    'Escludi date future, pagine evergreen, notizie vecchie e riempitivi. Non estendere la ricerca a 7–30 giorni per raggiungere un numero minimo; se non ci sono novità verificabili, restituisci un elenco vuoto.'
  ].join('\n');
}
