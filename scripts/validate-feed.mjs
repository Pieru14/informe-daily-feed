import { readFile } from 'node:fs/promises';
import { validateDailyNote } from './daily-note.mjs';

const inputPath = process.argv[2] || 'data/current.json';
const raw = await readFile(inputPath, 'utf8');
const feed = JSON.parse(raw);

function fail(message) {
  throw new Error('Feed non valido: ' + message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(label + ' deve essere un oggetto.');
  }
  return value;
}

function list(value, label, exactLength) {
  if (!Array.isArray(value)) fail(label + ' deve essere una lista.');
  if (exactLength !== undefined && value.length !== exactLength) {
    fail(label + ' deve contenere esattamente ' + exactLength + ' elementi.');
  }
  return value;
}

function text(value, label, minimum = 1, maximum = 900) {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum) {
    fail(label + ' deve essere un testo valido.');
  }
  return value.trim();
}

function secureUrl(value, label) {
  const candidate = text(value, label, 8, 1800);
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    fail(label + ' non è un URL.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    fail(label + ' deve essere un URL HTTPS senza credenziali.');
  }
  return parsed.href;
}

function uniqueIds(items, label) {
  const ids = new Set();
  items.forEach((item, index) => {
    const id = text(object(item, label + '[' + index + ']').id, label + '[' + index + '].id', 6, 180);
    if (ids.has(id)) fail(label + ' contiene ID duplicati.');
    ids.add(id);
  });
}

function validateUpdate(item, index) {
  const value = object(item, 'brandPulse.updates[' + index + ']');
  text(value.id, 'update.id', 6, 180);
  text(value.brand, 'update.brand', 2, 80);
  text(value.label, 'update.label', 3, 100);
  text(value.title, 'update.title', 4, 180);
  text(value.perspective, 'update.perspective', 24, 700);
  text(value.source, 'update.source', 3, 180);
  secureUrl(value.url, 'update.url');
}

function validateDirection(item, index) {
  const value = object(item, 'dailyEdition.directions[' + index + ']');
  text(value.id, 'direction.id', 6, 180);
  if (!['blue', 'pink', 'lime'].includes(value.tone)) fail('direction.tone non è supportato.');
  text(value.category, 'direction.category', 3, 100);
  text(value.title, 'direction.title', 5, 180);
  text(value.body, 'direction.body', 24, 700);
}

function validateNote(item, index) {
  const value = object(item, 'dailyEdition.notes[' + index + ']');
  text(value.id, 'note.id', 6, 180);
  text(value.type, 'note.type', 3, 100);
  text(value.title, 'note.title', 5, 180);
  text(value.body, 'note.body', 24, 700);
  text(value.source, 'note.source', 3, 180);
  secureUrl(value.url, 'note.url');
}

function validatePractice(item, index) {
  const value = object(item, 'dailyEdition.practice[' + index + ']');
  text(value.id, 'practice.id', 6, 180);
  text(value.number, 'practice.number', 1, 4);
  text(value.label, 'practice.label', 3, 60);
  text(value.title, 'practice.title', 5, 180);
  text(value.body, 'practice.body', 24, 700);
}

object(feed, 'feed');
if (feed.dailyNote !== undefined) validateDailyNote(feed.dailyNote);
if (feed.schemaVersion !== 1) fail('schemaVersion deve essere 1.');
text(feed.editionId, 'editionId', 8, 80);
if (Number.isNaN(Date.parse(text(feed.updatedAt, 'updatedAt', 20, 50)))) {
  fail('updatedAt deve essere una data ISO.');
}

const coverage = object(feed.sourceCoverage, 'sourceCoverage');
if (!Number.isInteger(coverage.configuredBrands) || coverage.configuredBrands < 1) {
  fail('sourceCoverage.configuredBrands deve essere un numero positivo.');
}
list(coverage.consultedSources, 'sourceCoverage.consultedSources').forEach((entry, index) => {
  text(entry, 'sourceCoverage.consultedSources[' + index + ']', 3, 220);
});
list(coverage.unavailable, 'sourceCoverage.unavailable').forEach((entry, index) => {
  text(entry, 'sourceCoverage.unavailable[' + index + ']', 3, 220);
});
text(coverage.caveat, 'sourceCoverage.caveat', 20, 400);

const pulse = object(feed.brandPulse, 'brandPulse');
text(pulse.refreshedAt, 'brandPulse.refreshedAt', 8, 140);
const updates = list(pulse.updates, 'brandPulse.updates');
if (updates.length < 5 || updates.length > 10) {
  fail('brandPulse.updates deve contenere da 5 a 10 notizie.');
}
updates.forEach(validateUpdate);
uniqueIds(updates, 'brandPulse.updates');

const edition = object(feed.dailyEdition, 'dailyEdition');
text(edition.refreshedAt, 'dailyEdition.refreshedAt', 8, 140);
const focus = object(edition.focus, 'dailyEdition.focus');
text(focus.id, 'focus.id', 6, 180);
text(focus.eyebrow, 'focus.eyebrow', 3, 120);
text(focus.title, 'focus.title', 5, 180);
text(focus.body, 'focus.body', 24, 700);
text(focus.source, 'focus.source', 3, 180);
secureUrl(focus.url, 'focus.url');

const directions = list(edition.directions, 'dailyEdition.directions', 3);
directions.forEach(validateDirection);
uniqueIds(directions, 'dailyEdition.directions');

const palette = list(edition.palette, 'dailyEdition.palette', 5);
palette.forEach((item, index) => {
  const color = object(item, 'palette[' + index + ']');
  text(color.name, 'palette.name', 3, 80);
  if (typeof color.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.hex)) {
    fail('palette.hex deve essere un colore esadecimale.');
  }
  if (typeof color.text !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.text)) {
    fail('palette.text deve essere un colore esadecimale.');
  }
});

const notes = list(edition.notes, 'dailyEdition.notes', 3);
notes.forEach(validateNote);
uniqueIds(notes, 'dailyEdition.notes');

const practice = list(edition.practice, 'dailyEdition.practice', 3);
practice.forEach(validatePractice);
uniqueIds(practice, 'dailyEdition.practice');

const everyId = [
  ...updates.map((item) => item.id),
  focus.id,
  ...directions.map((item) => item.id),
  ...notes.map((item) => item.id),
  ...practice.map((item) => item.id)
];
if (new Set(everyId).size !== everyId.length) fail('Gli ID devono essere unici nell’intera edizione.');

console.log('Feed valido: ' + feed.editionId + ' · ' + updates.length + ' aggiornamenti.');
