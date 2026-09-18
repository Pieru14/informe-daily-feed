import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const file = (...parts) => path.join(root, ...parts);
const isDryRun = process.argv.includes('--dry-run');
const isForced = ['1', 'true', 'yes'].includes(String(process.env.INFORME_FORCE_UPDATE || '').toLowerCase());
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const timezone = 'Europe/Rome';

const feedPath = file('data', 'current.json');
const seenPath = file('data', 'seen-urls.json');
const runtimePath = file('data', 'runtime.json');
const archiveDir = file('data', 'archive');

function fail(message) {
  throw new Error(message);
}

async function readJson(target, fallback) {
  try {
    return JSON.parse(await readFile(target, 'utf8'));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function localClock(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    date: values.year + '-' + values.month + '-' + values.day,
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function italianDate(date) {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: timezone,
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function normalizeUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

function sourceIdentity(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  parsed.hostname = parsed.hostname.replace(/^www\./i, '');
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.href;
}

function hasAllowedHost(url, allowedDomains) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  const host = new URL(normalized).hostname.toLowerCase();
  return allowedDomains.some((domain) => host === domain || host.endsWith('.' + domain));
}

function compactText(value, label, minimum = 1, maximum = 700) {
  if (typeof value !== 'string') fail(label + ' non è testo.');
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < minimum || text.length > maximum) fail(label + ' non ha una lunghezza valida.');
  return text;
}

function readableTextColor(hex) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness >= 150 ? '#111111' : '#FFFFFF';
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' non è un oggetto.');
  return value;
}

function list(value, label) {
  if (!Array.isArray(value)) fail(label + ' non è una lista.');
  return value;
}

function slug(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'informe';
}

function editionNumber(feed) {
  const current = String(feed?.editionId || '');
  const match = current.match(/-(\d{1,4})$/);
  return match ? Number(match[1]) + 1 : 1;
}

function collectUrls(value, found = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectUrls(entry, found));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => {
      if (key.toLowerCase() === 'url' && typeof entry === 'string') {
        const normalized = normalizeUrl(entry);
        if (normalized) found.add(normalized);
      } else {
        collectUrls(entry, found);
      }
    });
  }
  return found;
}

function addOfficialSearchUrl(found, value, allowedDomains) {
  const normalized = normalizeUrl(value);
  if (normalized && hasAllowedHost(normalized, allowedDomains)) found.add(normalized);
}

function collectSearchSourceUrls(payload, allowedDomains) {
  const found = new Set();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  output.forEach((item) => {
    if (item?.type === 'web_search_call') {
      const action = item.action || {};
      if (Array.isArray(action.sources)) {
        action.sources.forEach((source) => addOfficialSearchUrl(found, source?.url, allowedDomains));
      }
      if (['open_page', 'find_in_page'].includes(action.type)) {
        addOfficialSearchUrl(found, action.url, allowedDomains);
      }
      return;
    }

    if (item?.type !== 'message' || !Array.isArray(item?.content)) return;
    item.content.forEach((content) => {
      if (!Array.isArray(content?.annotations)) return;
      content.annotations.forEach((annotation) => {
        if (annotation?.type !== 'url_citation') return;
        addOfficialSearchUrl(found, annotation.url || annotation.url_citation?.url, allowedDomains);
      });
    });
  });
  return [...found];
}

function responseText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const chunks = [];
  list(response.output || [], 'Risposta API.output').forEach((item) => {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) return;
    item.content.forEach((content) => {
      if (content?.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    });
  });
  const text = chunks.join('\n').trim();
  if (!text) fail('L’AI non ha restituito testo strutturato.');
  return text;
}

const textSchema = { type: 'string' };
const updateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    brand: textSchema,
    category: textSchema,
    dateOrSeason: textSchema,
    title: textSchema,
    perspective: textSchema,
    source: textSchema,
    url: textSchema
  },
  required: ['brand', 'category', 'dateOrSeason', 'title', 'perspective', 'source', 'url']
};
const focusSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: textSchema,
    body: textSchema,
    source: textSchema,
    url: textSchema
  },
  required: ['title', 'body', 'source', 'url']
};
const directionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tone: { type: 'string', enum: ['blue', 'pink', 'lime'] },
    category: textSchema,
    title: textSchema,
    body: textSchema
  },
  required: ['tone', 'category', 'title', 'body']
};
const paletteSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: textSchema,
    hex: textSchema
  },
  required: ['name', 'hex']
};
const noteSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: textSchema,
    title: textSchema,
    body: textSchema,
    source: textSchema,
    url: textSchema
  },
  required: ['type', 'title', 'body', 'source', 'url']
};
const practiceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: textSchema,
    title: textSchema,
    body: textSchema
  },
  required: ['label', 'title', 'body']
};
const editorialSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['publish', 'skip'] },
    reason: textSchema,
    updates: { type: 'array', items: updateSchema },
    focus: focusSchema,
    directions: { type: 'array', items: directionSchema },
    palette: { type: 'array', items: paletteSchema },
    notes: { type: 'array', items: noteSchema },
    practice: { type: 'array', items: practiceSchema }
  },
  required: ['decision', 'reason', 'updates', 'focus', 'directions', 'palette', 'notes', 'practice']
};

async function askEditor({ allowedDomains, seenUrls, today }) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) {
    fail('Manca OPENAI_API_KEY. Aggiungila nei Secrets di GitHub, non nei file.');
  }

  const brands = await readJson(file('config', 'official-domains.json'));
  const policy = await readFile(file('config', 'editorial-policy.md'), 'utf8');
  const brandLine = brands.map((entry) => entry.brand + ' (' + entry.surface + ')').join(', ');
  const knownUrls = [...seenUrls].slice(-500).join('\n');
  const input = [
    policy,
    '',
    'Oggi è ' + today + ' nel fuso Europe/Rome.',
    'Cerca novità degli ultimi 7 giorni su: ' + brandLine + '.',
    'La ricerca web è filtrata ai soli domini ufficiali. Devi usare la ricerca prima di decidere.',
    'Le fonti già pubblicate qui sotto non possono essere riproposte come nuove:',
    knownUrls || '(nessuna)',
    '',
    'Restituisci solo JSON conforme allo schema.',
    'Se non trovi almeno 5 novità distinte e verificabili con una fonte ufficiale consultata, usa decision "skip", spiega il motivo in reason e restituisci liste vuote e stringhe vuote per focus.',
    'Se pubblichi, restituisci da 5 a 10 updates. Ogni url deve corrispondere a una fonte ufficiale aperta dalla ricerca: copia l’indirizzo della fonte, non ricostruirlo. Non usare URL di ricerca, social, riviste o e-commerce non ufficiale.',
    'La parte perspective, focus, directions, palette, notes e practice è una lettura creativa italiana fondata nelle notizie; non aggiungere fatti non verificati.',
    'Focus e notes devono linkare soltanto fonti ufficiali consultate. Sono richieste esattamente 3 directions, 5 colori (name e hex nel formato #RRGGBB), 3 notes e 3 practice.'
  ].join('\n');

  const apiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      tool_choice: 'required',
      tools: [{
        type: 'web_search',
        search_context_size: 'medium',
        filters: { allowed_domains: allowedDomains }
      }],
      include: ['web_search_call.action.sources'],
      max_output_tokens: 3600,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: 'informe_daily_edition',
          strict: true,
          schema: editorialSchema
        }
      }
    })
  });

  if (!apiResponse.ok) {
    const message = (await apiResponse.text()).slice(0, 800);
    fail('La ricerca editoriale non è disponibile: ' + apiResponse.status + ' ' + message);
  }

  const payload = await apiResponse.json();
  const sourceUrls = collectSearchSourceUrls(payload, allowedDomains);
  if (sourceUrls.length === 0) fail('La ricerca non ha restituito fonti ufficiali utilizzabili.');

  let draft;
  try {
    draft = JSON.parse(responseText(payload));
  } catch {
    fail('L’AI non ha restituito JSON valido.');
  }
  return { draft, sourceUrls };
}

function requireOfficialUrl(value, label, allowedDomains, sourceUrls) {
  const url = normalizeUrl(value);
  if (!url || !hasAllowedHost(url, allowedDomains)) fail(label + ' non appartiene alla watchlist ufficiale.');
  if (sourceUrls.has(url)) return url;
  const identity = sourceIdentity(url);
  for (const sourceUrl of sourceUrls) {
    if (sourceIdentity(sourceUrl) === identity) return sourceUrl;
  }
  fail(label + ' non compare tra le fonti realmente consultate.');
}

function buildEdition({ draft, sourceUrls, allowedDomains, seenUrls, now, today, previous }) {
  const output = object(draft, 'Bozza editoriale');
  if (output.decision === 'skip') return null;
  if (output.decision !== 'publish') fail('La decisione editoriale non è valida.');

  const rawUpdates = list(output.updates, 'updates');
  if (rawUpdates.length < 5 || rawUpdates.length > 10) fail('Servono da 5 a 10 notizie verificabili.');

  const nextNumber = editionNumber(previous);
  const readable = italianDate(now) + ' · edizione ' + String(nextNumber).padStart(2, '0');
  const ids = new Set();
  const updateUrls = new Set();
  const updates = [];
  rawUpdates.forEach((item, index) => {
    const update = object(item, 'updates[' + index + ']');
    const brand = compactText(update.brand, 'brand', 2, 80);
    const category = compactText(update.category, 'category', 3, 48);
    const dateOrSeason = compactText(update.dateOrSeason, 'dateOrSeason', 2, 48);
    const title = compactText(update.title, 'title', 5, 180);
    const perspective = compactText(update.perspective, 'perspective', 24, 700);
    const url = requireOfficialUrl(update.url, 'update.url', allowedDomains, sourceUrls);
    if (seenUrls.has(url) || updateUrls.has(url)) {
      console.log('Aggiornamento scartato perché la fonte è già presente: ' + url);
      return;
    }
    updateUrls.add(url);
    const id = slug(brand) + '-' + slug(title) + '-' + today + '-' + String(updates.length + 1).padStart(2, '0');
    if (ids.has(id)) fail('ID di aggiornamento duplicato.');
    ids.add(id);
    updates.push({
      id,
      brand,
      label: category + ' · ' + dateOrSeason,
      title,
      perspective,
      source: compactText(update.source, 'source', 3, 180),
      url
    });
  });
  if (updates.length < 5) {
    console.log('Bozza editoriale non pubblicata: dopo la deduplicazione restano meno di cinque fonti nuove e distinte.');
    return null;
  }

  const focus = object(output.focus, 'focus');
  const focusUrl = requireOfficialUrl(focus.url, 'focus.url', allowedDomains, sourceUrls);
  const directionInputs = list(output.directions, 'directions');
  const paletteInputs = list(output.palette, 'palette');
  const noteInputs = list(output.notes, 'notes');
  const practiceInputs = list(output.practice, 'practice');
  if (directionInputs.length !== 3 || paletteInputs.length !== 5 || noteInputs.length !== 3 || practiceInputs.length !== 3) {
    fail('La forma dell’edizione non è completa.');
  }

  const directions = directionInputs.map((item, index) => {
    const direction = object(item, 'directions[' + index + ']');
    const title = compactText(direction.title, 'direction.title', 5, 180);
    const id = 'direction-' + slug(title) + '-' + today + '-' + String(index + 1).padStart(2, '0');
    if (ids.has(id)) fail('ID direzione duplicato.');
    ids.add(id);
    return {
      id,
      tone: ['blue', 'pink', 'lime'].includes(direction.tone) ? direction.tone : ['blue', 'pink', 'lime'][index],
      category: compactText(direction.category, 'direction.category', 3, 100),
      title,
      body: compactText(direction.body, 'direction.body', 24, 700)
    };
  });

  const palette = paletteInputs.map((item, index) => {
    const color = object(item, 'palette[' + index + ']');
    const hex = compactText(color.hex, 'palette.hex', 7, 7).toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex)) fail('Palette non valida.');
    return {
      name: compactText(color.name, 'palette.name', 3, 80),
      hex,
      text: readableTextColor(hex)
    };
  });

  const notes = noteInputs.map((item, index) => {
    const note = object(item, 'notes[' + index + ']');
    const title = compactText(note.title, 'note.title', 5, 180);
    const id = 'note-' + slug(title) + '-' + today + '-' + String(index + 1).padStart(2, '0');
    if (ids.has(id)) fail('ID field note duplicato.');
    ids.add(id);
    return {
      id,
      type: compactText(note.type, 'note.type', 3, 100),
      title,
      body: compactText(note.body, 'note.body', 24, 700),
      source: compactText(note.source, 'note.source', 3, 180),
      url: requireOfficialUrl(note.url, 'note.url', allowedDomains, sourceUrls)
    };
  });

  const practice = practiceInputs.map((item, index) => {
    const exercise = object(item, 'practice[' + index + ']');
    const title = compactText(exercise.title, 'practice.title', 5, 180);
    const id = 'practice-' + slug(title) + '-' + today + '-' + String(index + 1).padStart(2, '0');
    if (ids.has(id)) fail('ID innesco duplicato.');
    ids.add(id);
    return {
      id,
      number: String(index + 1).padStart(2, '0'),
      label: compactText(exercise.label, 'practice.label', 3, 60),
      title,
      body: compactText(exercise.body, 'practice.body', 24, 700)
    };
  });

  const consultedSources = [...new Set([...sourceUrls].map((url) => new URL(url).hostname))].sort();
  return {
    schemaVersion: 1,
    editionId: today + '-' + String(nextNumber).padStart(2, '0'),
    updatedAt: now.toISOString(),
    sourceCoverage: {
      configuredBrands: allowedDomains.length,
      consultedSources,
      unavailable: [],
      caveat: 'Selezione editoriale da fonti ufficiali: il radar copre una watchlist ampia, non ogni maison esistente.'
    },
    brandPulse: {
      refreshedAt: readable,
      updates
    },
    dailyEdition: {
      refreshedAt: readable,
      focus: {
        id: 'focus-' + slug(focus.title) + '-' + today + '-' + String(nextNumber).padStart(2, '0'),
        eyebrow: 'THE DAILY FILE / ' + String(nextNumber).padStart(3, '0'),
        title: compactText(focus.title, 'focus.title', 5, 180),
        body: compactText(focus.body, 'focus.body', 24, 700),
        source: compactText(focus.source, 'focus.source', 3, 180),
        url: focusUrl
      },
      directions,
      palette,
      notes,
      practice
    }
  };
}

async function writeRuntime(payload) {
  await writeJson(runtimePath, {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ...payload
  });
}

const now = new Date();
const clock = localClock(now);
const sources = await readJson(file('config', 'official-domains.json'));
const allowedDomains = list(sources, 'official-domains').map((entry) => compactText(object(entry, 'source').domain, 'domain', 3, 160).toLowerCase());
const previous = await readJson(feedPath);
const seenUrls = new Set((await readJson(seenPath, [])).map(normalizeUrl).filter(Boolean));

if (isDryRun) {
  console.log('Configurazione valida: ' + allowedDomains.length + ' domini ufficiali, ' + seenUrls.size + ' fonti già pubblicate.');
  process.exit(0);
}

if (process.env.GITHUB_EVENT_NAME === 'schedule' && !isForced && clock.hour < 7) {
  await writeRuntime({
    result: 'waiting_for_rome_morning',
    localDate: clock.date,
    message: 'Esecuzione anticipata: nessuna ricerca avviata prima della mattina italiana.'
  });
  process.exit(0);
}

try {
  const { draft, sourceUrls } = await askEditor({ allowedDomains, seenUrls, today: clock.date });
  if (draft?.decision === 'skip') {
    await writeRuntime({
      result: 'no_new_verified_updates',
      localDate: clock.date,
      consultedOfficialSources: sourceUrls.length,
      message: compactText(draft.reason, 'reason', 3, 600)
    });
    console.log('Nessuna nuova edizione: ' + compactText(draft.reason, 'reason', 3, 600));
    process.exit(0);
  }

  const feed = buildEdition({
    draft,
    sourceUrls: new Set(sourceUrls),
    allowedDomains,
    seenUrls,
    now,
    today: clock.date,
    previous
  });
  if (!feed) {
    await writeRuntime({
      result: 'no_new_verified_updates',
      localDate: clock.date,
      message: 'Nessuna lettura editoriale significativa.'
    });
    process.exit(0);
  }

  const newUrls = [...collectUrls(feed)];
  const nextSeen = [...new Set([...seenUrls, ...newUrls])].slice(-500);
  await writeJson(feedPath, feed);
  await writeJson(path.join(archiveDir, feed.editionId + '.json'), feed);
  await writeJson(seenPath, nextSeen);
  await writeRuntime({
    result: 'published',
    localDate: clock.date,
    editionId: feed.editionId,
    consultedOfficialSources: feed.sourceCoverage.consultedSources.length,
    message: 'Nuova edizione verificata e pubblicata.'
  });
  console.log('Nuova edizione pronta: ' + feed.editionId);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
