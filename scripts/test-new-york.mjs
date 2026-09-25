import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildNewYorkDesk, validateNewYorkDesk, failedDesk } from './new-york-desk.mjs';
import { noteDate } from './daily-note.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scripts);
const now = new Date();
const today = noteDate(now);
const article = { scope: 'new_york', brand: 'CFDA', category: 'evento', publishedOn: today,
  dateOrSeason: 'Settembre 2026', geography: 'New York', geographyEvidence: 'La fonte identifica la sede dell’evento a New York.',
  title: 'Evento test a New York', fact: 'Fatto sintetico di test, non destinato alla pubblicazione.',
  communication: 'Lettura sintetica della comunicazione usata soltanto come fixture.',
  relevance: 'Un esempio di osservazione operativa destinato esclusivamente al test.',
  source: 'CFDA test', url: 'https://cfda.com/news/test-fixture' };
const options = { sourceUrls: [article.url], domains: ['cfda.com', 'missoni.com'], seenUrls: [], now, today };
const build = (items, extra = {}) => buildNewYorkDesk({ ...options, draft: { updates: items }, ...extra });
const desk = build([article]).desk;

test('fonte, data, geografia e identificatori verificati; deduplica varianti URL', () => {
  validateNewYorkDesk(desk);
  assert.equal(desk.status, 'updated');
  const duplicate = build([{ ...article, url: 'https://www.cfda.com/news/test-fixture/?utm_source=test#x' }],
    { seenUrls: [article.url], previous: desk, now: new Date(now.getTime() + 60000) }).desk;
  assert.equal(duplicate.status, 'no_new_verified_updates');
  assert.deepEqual(duplicate.updates, desk.updates);
  assert.equal(duplicate.updatedAt, desk.updatedAt);
});

test('date assenti, future, vecchie e fonti non consultate non diventano news', () => {
  for (const patch of [{ publishedOn: null }, { publishedOn: '2099-01-01' }, { publishedOn: '2020-01-01' },
    { publishedOn: '2026-02-30' }, { url: 'https://example.com/news' }, { geographyEvidence: '' }, { scope: 'missoni' }]) {
    const result = build([{ ...article, ...patch }]).desk;
    assert.equal(result.updates.length, 0);
    assert.equal(result.status, 'not_verified');
  }
  assert.throws(() => validateNewYorkDesk({ ...desk, updatedAt: new Date(now.getTime() + 60000).toISOString() }));
});

test('errore e assenza di novità conservano notizie e date precedenti', () => {
  for (const next of [failedDesk(desk, now), build([], { previous: desk }).desk]) {
    assert.deepEqual(next.updates, desk.updates);
    assert.equal(next.updatedAt, desk.updatedAt);
  }
});

async function simulate(script, draft, previous, fail = false) {
  const temp = await mkdtemp(path.join(tmpdir(), 'informe-dual-radar-test-'));
  for (const directory of ['data', 'config']) await mkdir(path.join(temp, directory));
  for (const name of ['official-domains.json', 'new-york-sources.json', 'editorial-policy.md']) await copyFile(path.join(root, 'config', name), path.join(temp, 'config', name));
  await writeFile(path.join(temp, 'data/current.json'), JSON.stringify(previous));
  await writeFile(path.join(temp, 'data/seen-urls.json'), JSON.stringify(['https://www.dior.com/test-previous']));
  const response = { status: 'completed', output_text: JSON.stringify(draft), output: [{ type: 'web_search_call', action: { sources: [{ url: article.url }] } }] };
  const mock = 'globalThis.fetch = async (url, options) => { const body=JSON.parse(options.body); if(url!=="https://api.openai.com/v1/responses" || body.model!=="gpt-5.5" || body.store!==false) throw Error("Unexpected API request"); return {ok:' + !fail + ',status:429,text:async()=>"Test failure",json:async()=>(' + JSON.stringify(response) + ')}; };';
  const mockPath = path.join(temp, 'mock.mjs');
  await writeFile(mockPath, mock);
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(mockPath).href, path.join(scripts, script)], {
    cwd: temp, env: { ...process.env, OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'gpt-5.5', GITHUB_EVENT_NAME: 'workflow_dispatch' }, encoding: 'utf8'
  });
  assert.equal(run.status, fail ? 1 : 0, run.stderr);
  const next = JSON.parse(await readFile(path.join(temp, 'data/current.json'), 'utf8'));
  const seen = JSON.parse(await readFile(path.join(temp, 'data/seen-urls.json'), 'utf8'));
  assert.deepEqual(seen, ['https://www.dior.com/test-previous']);
  return next;
}
const fixture = JSON.parse(await readFile(path.join(root, 'data/current.json'), 'utf8'));
for (const [label, draft, fail] of [['publish', { updates: [article] }, false], ['empty', { updates: [] }, false], ['error', null, true]]) {
  test('sera ' + label + ': il radar principale resta identico', async () => {
    const previous = { ...fixture, newYorkDesk: desk };
    const next = await simulate('update-new-york.mjs', draft, previous, fail);
    const { newYorkDesk: oldDesk, ...mainBefore } = previous;
    const { newYorkDesk: nextDesk, ...mainAfter } = next;
    assert.deepEqual(mainAfter, mainBefore);
    assert.ok(nextDesk.checkedAt);
    validateNewYorkDesk(nextDesk);
  });
}
for (const fail of [false, true]) test('mattina ' + (fail ? 'errore' : 'skip') + ': il desk serale resta identico', async () => {
  const next = await simulate('update-edition.mjs', { decision: 'skip', reason: 'Nessuna novità verificata.',
    dailyNote: 'Lascia spazio alla curiosità: un piccolo dettaglio può diventare una nuova strada da esplorare con il tuo sguardo.' }, { ...fixture, newYorkDesk: desk }, fail);
  assert.deepEqual(next.newYorkDesk, desk);
});

test('due orari italiani e un solo blocco di scrittura condiviso', async () => {
  const morning = await readFile(path.join(root, '.github/workflows/daily-edition.yml'), 'utf8');
  const evening = await readFile(path.join(root, '.github/workflows/new-york.yml'), 'utf8');
  assert.match(morning, /cron: "30 10 \* \* \*"/);
  assert.match(evening, /cron: "30 18 \* \* \*"/);
  for (const workflow of [morning, evening]) {
    assert.match(workflow, /timezone: "Europe\/Rome"/);
    assert.match(workflow, /group: informe-daily-edition/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /ref: main/);
  }
});
