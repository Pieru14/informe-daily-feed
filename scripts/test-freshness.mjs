import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validDay, validInstant, researchWindow, verifyPublication, validatePublicationMetadata, freshnessBrief } from './freshness.mjs';

const now = new Date('2026-09-25T08:30:00.000Z');
const window = researchWindow(now, { lastSuccessfulSearchAt: '2026-09-24T08:30:00.000Z' });
const article = { publishedOn: '2026-09-25', publicationEvidence: 'Comunicato: pubblicato il 25 settembre 2026.' };

test('validDay controlla giorni reali, bisestili e formato senza normalizzare date errate', () => {
  for (const day of ['2026-09-25', '2024-02-29', '2000-02-29', '2026-04-30']) assert.equal(validDay(day), true, day);
  for (const day of ['2026-02-29', '2026-04-31', '1900-02-29', '2026-09-00', '2026-13-01', '2026-9-25', ' 2026-09-25', null, 20260925]) assert.equal(validDay(day), false, String(day));
});

test('bootstrap di 48 ore e cambio mese mantengono date italiane corrette', () => {
  assert.deepEqual(researchWindow('2026-03-01T09:30:00Z'), {
    since: '2026-02-27T09:30:00.000Z', until: '2026-03-01T09:30:00.000Z',
    fromDate: '2026-02-27', toDate: '2026-03-01', timezone: 'Europe/Rome'
  });
  assert.equal(researchWindow('2026-09-24T23:00:00Z').toDate, '2026-09-25');
  assert.throws(() => researchWindow(new Date('invalid')));
  assert.throws(() => researchWindow('2026-02-30T09:30:00Z'));
});

test('ora legale italiana usa gli istanti reali anche durante giornate di 23 e 25 ore', () => {
  const spring = researchWindow('2026-03-29T08:30:00Z', { lastSuccessfulSearchAt: '2026-03-28T09:30:00Z' });
  assert.equal((Date.parse(spring.until) - Date.parse(spring.since)) / 3600000, 23);
  assert.equal(spring.toDate, '2026-03-29');
  const autumn = researchWindow('2026-10-25T09:30:00Z', { lastSuccessfulSearchAt: '2026-10-24T08:30:00Z' });
  assert.equal((Date.parse(autumn.until) - Date.parse(autumn.since)) / 3600000, 25);
  assert.equal(autumn.toDate, '2026-10-25');
});

test('un controllo fallito non avanza il cursore e un recupero è limitato a sette giorni', () => {
  const previous = { lastSuccessfulSearchAt: '2026-09-23T08:30:00Z', checkedAt: '2026-09-24T08:30:00Z', checkStatus: 'error' };
  assert.equal(researchWindow(now, previous).since, '2026-09-23T08:30:00.000Z');
  for (const status of ['error', 'failed', 'not_verified']) {
    assert.equal(researchWindow(now, { checkedAt: '2026-09-25T07:00:00Z', status }).since, '2026-09-23T08:30:00.000Z');
    assert.equal(researchWindow(now, { checkedAt: '2026-09-25T07:00:00Z', checkStatus: status, status: 'updated' }).since, '2026-09-23T08:30:00.000Z');
  }
  assert.equal(researchWindow(now, { lastSuccessfulSearchAt: '2026-08-01T08:30:00Z' }).since, '2026-09-18T08:30:00.000Z');
});

test('vecchi stati riusciti sono migrabili, cursori futuri o ambigui no', () => {
  for (const [field, statuses] of [['checkStatus', ['published', 'no_new_verified_updates']], ['status', ['updated', 'no_new_verified_updates']]]) {
    for (const status of statuses) assert.equal(researchWindow(now, { checkedAt: '2026-09-24T08:30:00Z', [field]: status }).since, window.since);
  }
  for (const lastSuccessfulSearchAt of ['2099-01-01T08:30:00Z', '2026-09-24', '2026-09-24T08:30:00', 'nope']) {
    assert.equal(researchWindow(now, { lastSuccessfulSearchAt }).since, '2026-09-23T08:30:00.000Z');
  }
  assert.equal(researchWindow(now, { lastSuccessfulSearchAt: now.toISOString() }).since, now.toISOString());
});

test('date senza ora restano date, accettano entrambi i giorni del controllo e richiedono evidenza', () => {
  assert.deepEqual(verifyPublication(article, window), { ...article, publishedAt: null });
  assert.equal(verifyPublication({ ...article, publishedOn: window.fromDate }, window).publishedAt, null);
  for (const patch of [
    { publishedOn: '2026-09-23' }, { publishedOn: '2026-09-26' }, { publishedOn: '2026-02-30' },
    { publishedOn: undefined }, { publicationEvidence: null }, { publicationEvidence: '  ' },
    { publicationEvidence: 'oggi' }, { publicationEvidence: 'FW2026' }, { publicationEvidence: 'Autunno Inverno 2026' },
    { publicationEvidence: 'x'.repeat(181) }
  ]) assert.throws(() => verifyPublication({ ...article, ...patch }, window), JSON.stringify(patch));
});

test('timestamp documentati rispettano i limiti esatti e vengono normalizzati in UTC', () => {
  assert.equal(verifyPublication({ ...article, publishedAt: '2026-09-25T10:29:00+02:00' }, window).publishedAt, '2026-09-25T08:29:00.000Z');
  assert.equal(verifyPublication({ ...article, publishedAt: window.until }, window).publishedAt, window.until);
  assert.equal(verifyPublication({ ...article, publishedOn: '2026-09-24', publishedAt: window.since }, window).publishedAt, window.since);
  assert.throws(() => verifyPublication({ ...article, publishedAt: '2026-09-25T08:30:00.001Z' }, window));
  assert.throws(() => verifyPublication({ ...article, publishedOn: '2026-09-24', publishedAt: '2026-09-24T08:29:59Z' }, window));
  assert.throws(() => verifyPublication({ ...article, publishedOn: '2026-09-23', publishedAt: window.until }, window));
  const bootstrap = researchWindow(now);
  assert.throws(() => verifyPublication({ ...article, publishedOn: '2026-09-23', publishedAt: '2026-09-23T08:29:59Z' }, bootstrap));
});

test('fusi delle fonti USA non impongono artificialmente la data italiana', () => {
  const midnight = researchWindow('2026-09-25T00:30:00Z', { lastSuccessfulSearchAt: '2026-09-24T23:00:00Z' });
  assert.equal(midnight.fromDate, '2026-09-25');
  const news = verifyPublication({ ...article, publishedOn: '2026-09-24', publishedAt: '2026-09-24T20:15:00-04:00' }, midnight);
  assert.equal(news.publishedOn, '2026-09-24');
  assert.equal(news.publishedAt, '2026-09-25T00:15:00.000Z');
});

test('orari senza fuso, normalizzati da JavaScript o in formati ambigui sono respinti', () => {
  for (const publishedAt of [
    '', '2026-09-25', '2026-09-25T08:00:00', '2026-09-25 08:00:00Z', '2026-09-25T08:00Z',
    '2026-09-24T24:00:00Z', '2026-09-25T08:60:00Z', '2026-09-25T08:00:60Z',
    '2026-02-30T08:00:00Z', '2026-09-25T08:00:00+24:00', '2026-09-25T08:00:00+14:01',
    '2026-09-25T08:00:00+0200', '09/25/2026 08:00', 1790313600000
  ]) assert.throws(() => verifyPublication({ ...article, publishedAt }, window), String(publishedAt));
});

test('brief esplicita priorità di oggi, recupero tra controlli e limiti delle fonti senza ora', () => {
  const brief = freshnessBrief(window);
  for (const phrase of [window.since, window.until, window.toDate, 'precedente controllo riuscito', 'non puoi affermare', 'publicationEvidence', 'elenco vuoto']) assert.ok(brief.includes(phrase), phrase);
  assert.throws(() => freshnessBrief({ ...window, fromDate: '2026-09-01' }));
});

test('i metadati conservati sono verificati senza ridatare una notizia precedente', () => {
  assert.deepEqual(validatePublicationMetadata(article, '2026-09-26T08:30:00Z'), { ...article, publishedAt: null });
  assert.equal(validInstant('2026-09-26T10:30:00+02:00'), true);
  assert.equal(validInstant('2026-09-26T10:30:00'), false);
  assert.throws(() => validatePublicationMetadata(article, '2026-09-24T08:30:00Z'));
  assert.throws(() => validatePublicationMetadata({ ...article, publishedAt: '2026-09-25T08:31:00Z' }, now.toISOString()));
});

test('il validatore accetta i feed storici e controlla metadati nuovi, USA e finestre', async () => {
  const scripts = path.dirname(fileURLToPath(import.meta.url));
  const fixture = JSON.parse(await readFile(path.join(scripts, '../data/current.json'), 'utf8'));
  const temporary = await mkdtemp(path.join(tmpdir(), 'informe-freshness-validator-'));
  const validate = async (feed, expected) => {
    const target = path.join(temporary, 'feed.json');
    await writeFile(target, JSON.stringify(feed));
    const result = spawnSync(process.execPath, [path.join(scripts, 'validate-feed.mjs'), target], { encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr || result.stdout);
  };
  // Build a deliberately legacy-shaped fixture, independent of future real
  // feed editions, without writing to the project's data directory.
  const legacy = structuredClone(fixture);
  for (const name of ['freshnessPolicy', 'researchWindow', 'lastSuccessfulSearchAt']) {
    delete legacy[name];
    if (legacy.newYorkDesk) delete legacy.newYorkDesk[name];
  }
  for (const item of legacy.brandPulse.updates) {
    for (const name of ['publishedOn', 'publishedAt', 'publicationEvidence', 'addedAt']) delete item[name];
  }
  for (const item of legacy.newYorkDesk?.updates || []) {
    delete item.publishedAt; delete item.publicationEvidence;
  }
  await validate(legacy, 0);
  const dated = structuredClone(legacy);
  dated.updatedAt = '2026-09-26T08:31:00.000Z';
  dated.checkedAt = dated.updatedAt; dated.checkStatus = 'published'; dated.checkedSourceCount = 1;
  dated.freshnessPolicy = 'incremental-v1';
  dated.researchWindow = researchWindow('2026-09-26T08:30:00Z', { lastSuccessfulSearchAt: '2026-09-25T08:30:00Z' });
  dated.lastSuccessfulSearchAt = dated.researchWindow.until;
  Object.assign(dated.brandPulse.updates[0], article, { addedAt: '2026-09-25T08:30:00.000Z', publishedAt: null });
  await validate(dated, 0);
  for (const patch of [{ publishedOn: '2026-02-30' }, { publicationEvidence: null }, { publishedAt: '2026-09-25T08:30:01Z' }, { addedAt: '2026-09-27T08:30:00Z' }]) {
    const malformed = structuredClone(dated); Object.assign(malformed.brandPulse.updates[0], patch);
    await validate(malformed, 1);
  }
  const futureWindow = structuredClone(dated);
  futureWindow.researchWindow = researchWindow('2026-09-27T08:30:00Z');
  await validate(futureWindow, 1);
  const futureCursor = structuredClone(dated); futureCursor.lastSuccessfulSearchAt = '2026-09-27T08:30:00Z';
  await validate(futureCursor, 1);
  if (dated.newYorkDesk?.updates.length) {
    const malformed = structuredClone(dated);
    malformed.newYorkDesk.updates[0].publicationEvidence = 'oggi';
    await validate(malformed, 1);
  }
});
