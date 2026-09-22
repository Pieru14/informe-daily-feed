import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { buildDailyNote, validateDailyNote, noteDate } from './daily-note.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scripts);
const now = new Date();
const today = noteDate(now);
const words = 'Dai spazio alla tua curiosità: anche un dettaglio imperfetto può aprire una strada che soltanto il tuo sguardo sa vedere.';

test('validazione, calendario italiano e stabilità nella stessa giornata', () => {
  const note = buildDailyNote({ text: words, today, now });
  assert.equal(note.date, today);
  assert.equal(buildDailyNote({ text: 'diversa', today, now, previous: note }), note);
  assert.throws(() => validateDailyNote({ ...note, date: '2026-02-30' }));
  assert.throws(() => validateDailyNote({ ...note, text: '<script>test unsafe text for rendering</script>' }));
  assert.throws(() => buildDailyNote({ text: words, today, now, previous: { ...note, date: '2020-01-01' } }));
  assert.equal(noteDate(new Date('2026-09-21T22:30:00Z')), '2026-09-22');
});

const fixture = JSON.parse(await readFile(path.join(root, 'data/current.json'), 'utf8'));
delete fixture.dailyNote;
delete fixture.checkedAt;
delete fixture.checkStatus;
delete fixture.checkedSourceCount;
const pulse = fixture.brandPulse.updates;
const edition = fixture.dailyEdition;
const publishDraft = {
  decision: 'publish', reason: 'Fixture senza richieste API.', dailyNote: words,
  updates: pulse.map(item => ({ ...item, category: 'collezione', dateOrSeason: '2026' })),
  focus: edition.focus, directions: edition.directions, palette: edition.palette,
  notes: edition.notes, practice: edition.practice
};
const officialUrls = [...new Set([...pulse.map(item => item.url), edition.focus.url, ...edition.notes.map(item => item.url)])];

async function simulate(draft, sources, seen = [], previous = fixture, apiFailure = false) {
  const temp = await mkdtemp(path.join(tmpdir(), 'informe-note-test-'));
  for (const directory of ['config', 'data']) await mkdir(path.join(temp, directory));
  const json = (name, value) => writeFile(path.join(temp, name), JSON.stringify(value, null, 2) + '\n');
  await json('data/current.json', previous);
  await json('data/seen-urls.json', seen);
  await json('config/official-domains.json', JSON.parse(await readFile(path.join(root, 'config/official-domains.json'), 'utf8')));
  await writeFile(path.join(temp, 'config/editorial-policy.md'), 'Fixture di test.');
  const response = { output_text: JSON.stringify(draft), output: [{ type: 'web_search_call', action: { sources: sources.map(url => ({ url })) } }] };
  // Replace fetch in a separate test process: no network, real key or paid requests.
  const mock = 'globalThis.fetch = async url => { if (url !== "https://api.openai.com/v1/responses") throw Error("Unexpected network"); return {ok:' + !apiFailure + ',status:429,text:async()=>"Test API failure",json:async()=>(' + JSON.stringify(response) + ')}; };';
  const mockPath = path.join(temp, 'mock.mjs');
  await writeFile(mockPath, mock);
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(mockPath).href, path.join(scripts, 'update-edition.mjs')], {
    cwd: temp, env: { ...process.env, OPENAI_API_KEY: 'test-only', GITHUB_EVENT_NAME: 'workflow_dispatch' }, stdio: 'pipe'
  });
  assert.equal(run.status, apiFailure ? 1 : 0, String(run.stderr));
  execFileSync(process.execPath, [path.join(scripts, 'validate-feed.mjs'), 'data/current.json'], { cwd: temp, stdio: 'pipe' });
  return {
    next: JSON.parse(await readFile(path.join(temp, 'data/current.json'), 'utf8')),
    seen: JSON.parse(await readFile(path.join(temp, 'data/seen-urls.json'), 'utf8')),
    temp
  };
}

test('skip anche senza fonti: aggiorna solo la frase, non le date delle notizie', async () => {
  const previous = { ...fixture };
  delete previous.dailyNote;
  const result = await simulate({ decision: 'skip', reason: 'Non ci sono nuove notizie verificate.', dailyNote: words }, [], officialUrls, previous);
  const { dailyNote, checkedAt, checkStatus, checkedSourceCount, ...news } = result.next;
  assert.deepEqual(news, previous);
  assert.equal(checkStatus, 'no_new_verified_updates');
  assert.equal(checkedSourceCount, 0);
  assert.ok(Date.parse(checkedAt));
  assert.equal(dailyNote.text, words);
  assert.deepEqual(result.seen, officialUrls);
  const rerun = await simulate({ decision: 'skip', reason: 'Nessuna nuova notizia.', dailyNote: 'Un altro pensiero valido che non deve sostituire la frase già scelta oggi.' }, [], officialUrls, result.next);
  assert.deepEqual(rerun.next.dailyNote, result.next.dailyNote);
  assert.equal(rerun.next.updatedAt, result.next.updatedAt);
});

test('tutte le notizie duplicate: aggiorna solo frase e controllo', async () => {
  const previous = { ...fixture };
  delete previous.dailyNote;
  const result = await simulate(publishDraft, officialUrls, officialUrls, previous);
  const { dailyNote, checkedAt, checkStatus, checkedSourceCount, ...news } = result.next;
  assert.deepEqual(news, previous);
  assert.equal(dailyNote.date, today);
});

test('una sola notizia verificata basta per pubblicare', async () => {
  const update = publishDraft.updates[0];
  const draft = { ...publishDraft, updates: [update], focus: { ...publishDraft.focus, url: update.url }, notes: publishDraft.notes.map(note => ({ ...note, url: update.url })) };
  const result = await simulate(draft, [update.url]);
  assert.equal(result.next.brandPulse.updates.length, 1);
  assert.equal(result.next.checkStatus, 'published');
  assert.notEqual(result.next.dailyEdition.focus.id, fixture.dailyEdition.focus.id);
});

test('deduplicazione parziale: nuove notizie, taccuino precedente non ridatato', async () => {
  const result = await simulate(publishDraft, officialUrls, [pulse[0].url]);
  assert.equal(result.next.brandPulse.updates.length, pulse.length - 1);
  assert.deepEqual(result.next.dailyEdition, fixture.dailyEdition);
  assert.notEqual(result.next.updatedAt, fixture.updatedAt);
});

test('errore API: segnala il controllo fallito e conserva tutti i contenuti', async () => {
  const result = await simulate(null, [], officialUrls, fixture, true);
  const { checkedAt, checkStatus, checkedSourceCount, ...news } = result.next;
  assert.deepEqual(news, fixture);
  assert.equal(checkStatus, 'error');
  assert.deepEqual(result.seen, officialUrls);
});

test('pensiero ripetuto: non impedisce nuove notizie e mantiene la data originale', async () => {
  const oldTime = new Date(Date.now() - 86400000);
  const previous = { ...fixture, dailyNote: { text: words, date: noteDate(oldTime), createdAt: oldTime.toISOString() } };
  const result = await simulate(publishDraft, officialUrls, [], previous);
  assert.equal(result.next.checkStatus, 'published');
  assert.deepEqual(result.next.dailyNote, previous.dailyNote);
});

test('edizione completa: pubblica notizie e frase insieme', async () => {
  const result = await simulate(publishDraft, officialUrls);
  assert.notEqual(result.next.editionId, fixture.editionId);
  assert.equal(result.next.dailyNote.date, today);
  const archived = JSON.parse(await readFile(path.join(result.temp, 'data/archive', result.next.editionId + '.json'), 'utf8'));
  assert.deepEqual(archived, result.next);
});
