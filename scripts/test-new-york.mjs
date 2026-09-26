import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildNewYorkDesk, validateNewYorkDesk, failedDesk } from './new-york-desk.mjs';
import { noteDate } from './daily-note.mjs';
import { competitorBrief, isExcludedBrand } from './competitor-research.mjs';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scripts);
const now = new Date();
const today = noteDate(now);
const competitors = JSON.parse(await readFile(path.join(root, 'config/competitors.json'), 'utf8'));
const article = { scope: 'new_york', brand: 'Etro', category: 'evento', publishedOn: today, publishedAt: null,
  publicationEvidence: 'Data pubblicata in testa al comunicato ufficiale: ' + today,
  dateOrSeason: 'Settembre 2026', geography: 'New York', geographyEvidence: 'La fonte identifica la sede dell’evento a New York.',
  title: 'Evento test a New York', fact: 'Fatto sintetico di test, non destinato alla pubblicazione.',
  communication: 'Lettura sintetica della comunicazione usata soltanto come fixture.',
  relevance: 'Un esempio di osservazione operativa destinato esclusivamente al test.',
  source: 'Etro test', url: 'https://www.etro.com/news/test-fixture' };
const options = { sourceUrls: [article.url], competitors, domains: competitors.map(item => item.domain), seenUrls: [], now, today };
const build = (items, extra = {}) => buildNewYorkDesk({ ...options, draft: { updates: items }, ...extra });
const desk = build([article]).desk;

test('fonte, data, geografia e identificatori verificati; deduplica varianti URL', () => {
  validateNewYorkDesk(desk);
  assert.equal(desk.status, 'updated');
  assert.equal(desk.freshnessPolicy, 'incremental-v1');
  assert.equal(desk.lastSuccessfulSearchAt, now.toISOString());
  assert.deepEqual(desk.radarCoverage.consultedBrands, ['Etro']);
  const duplicate = build([{ ...article, url: 'https://etro.com/news/test-fixture/?utm_source=test#x' }],
    { seenUrls: [article.url], previous: desk, now: new Date(now.getTime() + 60000) }).desk;
  assert.equal(duplicate.status, 'no_new_verified_updates');
  assert.deepEqual(duplicate.updates, desk.updates);
  assert.equal(duplicate.updatedAt, desk.updatedAt);
});

test('date assenti, future, vecchie e fonti non consultate non diventano news', () => {
  for (const patch of [{ publishedOn: null }, { publishedOn: '2099-01-01' }, { publishedOn: '2020-01-01' },
    { publishedOn: '2026-02-30' }, { url: 'https://example.com/news' },
    { url: 'https://www.etro.com/news/not-consulted' }, { geographyEvidence: '' }, { scope: 'missoni' },
    { publicationEvidence: '' }, { brand: 'Marni' }, { brand: 'CFDA', url: 'https://cfda.com/news/test-fixture' }]) {
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

test('fonti assenti ed errori non spostano l’ultimo controllo riuscito', () => {
  const later = new Date(now.getTime() + 60000);
  for (const next of [failedDesk(desk, later), build([], { sourceUrls: [], previous: desk, now: later }).desk]) {
    assert.equal(next.lastSuccessfulSearchAt, desk.lastSuccessfulSearchAt);
    assert.deepEqual(next.updates, desk.updates);
  }
  const rejected = { ...article, publishedOn: null };
  for (const previous of [undefined, desk]) {
    const next = build([rejected], { previous, now: later }).desk;
    assert.equal(next.lastSuccessfulSearchAt, previous?.lastSuccessfulSearchAt || next.researchWindow.since);
  }
});

test('una selezione nuova sostituisce le vecchie schede e mostra prima le pubblicazioni più recenti', () => {
  const previousTime = new Date(now.getTime() - 86400000);
  const oldArticle = { ...article, publishedOn: noteDate(previousTime), publishedAt: previousTime.toISOString(),
    publicationEvidence: 'Data nel comunicato: ' + noteDate(previousTime), url: 'https://www.etro.com/news/previous-fixture' };
  const oldDesk = build([oldArticle], { sourceUrls: [oldArticle.url], now: previousTime, today: noteDate(previousTime) }).desk;
  const afterPrevious = new Date(previousTime.getTime() + 60000);
  const recovered = { ...oldArticle, publishedOn: noteDate(afterPrevious), publishedAt: afterPrevious.toISOString(),
    url: 'https://www.etro.com/news/recovered-fixture' };
  const next = build([recovered, article], { sourceUrls: [recovered.url, article.url], previous: oldDesk }).desk;
  assert.equal(next.status, 'updated');
  assert.deepEqual(next.updates.map(item => item.url), [article.url, recovered.url]);
  assert.ok(!next.updates.some(item => item.url === oldArticle.url));
});

async function simulate(script, draft, previous, fail = false) {
  const temp = await mkdtemp(path.join(tmpdir(), 'informe-dual-radar-test-'));
  for (const directory of ['data', 'config']) await mkdir(path.join(temp, directory));
  for (const name of ['competitors.json', 'editorial-policy.md']) await copyFile(path.join(root, 'config', name), path.join(temp, 'config', name));
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
test('stessa watchlist ampia di maison nei due mercati, Missoni esclusa anche da una fonte terza', async () => {
  const sources = competitors;
  for (const brand of ['Etro', 'Marni', 'Prada', 'Gucci', 'Dior']) {
    assert.ok(sources.some(source => source.brand === brand), 'Watchlist maison senza ' + brand);
  }
  assert.ok(!sources.some(source => /missoni/i.test(source.brand + source.domain)));
  assert.ok(!sources.some(source => source.brand === 'CFDA'));
  assert.deepEqual(desk.radarCoverage.watchlist, sources.map(source => source.brand));
  assert.deepEqual(desk.radarCoverage.unverifiedBrands, sources.filter(source => source.brand !== 'Etro').map(source => source.brand));
  assert.equal(competitorBrief('Italia', sources).replace('Italia.', 'MERCATO.'), competitorBrief('USA', sources).replace('USA.', 'MERCATO.'));
  assert.equal(isExcludedBrand({brand:'Missoni',url:article.url}), true);
  assert.equal(isExcludedBrand({brand:'Etro',url:'https://www.missoni.com/news'}), true);
  const excluded = build([{...article,brand:'Missoni'}]).desk;
  assert.equal(excluded.updates.length, 0);
});
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
