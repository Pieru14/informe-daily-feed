import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { scanSources, scanBrief, scanCoverage, publishedMetadata, officialUrl, extractPage, radarWindow } from './source-scan.mjs';
import { matchesCompetitor, recentRadarLeads } from './competitor-research.mjs';
import { buildNewYorkDesk } from './new-york-desk.mjs';
import { verifyPublication } from './freshness.mjs';

const source = { brand: 'Prada', domain: 'prada.com', publisherDomains: ['pradagroup.com'], urls: ['https://www.prada.com/editorial'] };
const body = '<main><h1>Una nuova campagna</h1><p>' + 'Contenuto editoriale verificabile e distinto dai prodotti. '.repeat(10) + '</p><a href="/news/campaign">Scopri la campagna</a></main>';
const html = value => new Response(value, { headers: { 'content-type': 'text/html' } });

test('piste tra radar: solo recenti, ufficiali, non duplicate e da riaprire', () => {
  const window = radarWindow(new Date('2026-10-01T16:30:00Z'));
  const item = { brand: 'Prada', title: 'Notizia di test', url: 'https://www.prada.com/news/fresh', publishedOn: '2026-09-30', publicationEvidence: 'Pubblicato il 30 settembre 2026' };
  const prompt = recentRadarLeads([item, { ...item, url: 'https://www.prada.com/news/old', publishedOn: '2026-09-20' },
    { ...item, url: 'https://other.test/news' }, { ...item, url: 'https://www.prada.com/news/seen' }],
    { sources: [source], window, seenUrls: new Set(['https://prada.com/news/seen?utm=test']) });
  assert.ok(prompt.includes('/news/fresh'));
  assert.ok(prompt.includes('Non copiarli senza riapertura'));
  for (const text of ['/news/old', 'other.test', '/news/seen']) assert.equal(prompt.includes(text), false);
});

test('le press room ufficiali LVMH sono autorizzate per Loro Piana e Pucci', async () => {
  const sources = JSON.parse(await readFile(new URL('../config/competitors.json', import.meta.url), 'utf8'));
  for (const brand of ['Loro Piana', 'Pucci']) {
    assert.ok(matchesCompetitor({ brand, url: 'https://www.lvmh.com/en/news-lvmh/' + brand.toLowerCase().replace(/ /g, '-') }, sources));
    assert.equal(matchesCompetitor({ brand, url: 'https://www.lvmh.com.evil.test/news' }, sources), false);
  }
});

test('gli estratti degli articoli non sono esclusi dai due indici senza metadati', () => {
  const page = (url, isIndex) => ({ brand: 'Prada', url, isIndex, title: 'Prada', text: 'Contenuto editoriale', publicationMetadata: [], links: [] });
  const prompt = scanBrief({ reports: [{ brand: 'Prada', status: 'editorial_pages_read' }], documents: [
    page('https://www.prada.com/news-index', true), page('https://www.pradagroup.com/news-index', true),
    page('https://www.prada.com/news/article-one', false), page('https://www.prada.com/news/article-two', false)
  ] });
  assert.ok(prompt.includes('/news/article-one'));
  assert.ok(prompt.includes('/news/article-two'));
  assert.equal(prompt.includes('news-index'), false);
});

test('discovery di tutti i 33 brand prima dei dettagli e report senza copertura inventata', async () => {
  const brands = Array.from({ length: 33 }, (_, i) => ({ brand: 'Brand ' + i, domain: 'brand' + i + '.com', urls: ['https://brand' + i + '.com/editorial'] }));
  const requests = [];
  const scan = await scanSources(brands, { fetcher: async url => { requests.push(url); return html(body); } });
  assert.equal(scan.reports.length, 33);
  assert.ok(requests.slice(0, 33).every(url => url.endsWith('/editorial')));
  assert.equal(scanCoverage(brands, scan, []).attemptedBrands.length, 33);
  assert.equal(scanCoverage(brands, scan, []).consultedBrands.length, 33);
  assert.equal(scan.documents[0].publicationMetadata.length, 0);
});

test('403, bot challenge, pagina vuota e redirect esterno restano lacune', async () => {
  for (const response of [new Response('Blocked', { status: 403 }), html('<title>Just a moment</title>' + body),
    html('<main>0</main>'), new Response(null, { status: 302, headers: { location: 'https://example.org/news' } })]) {
    let calls = 0;
    const scan = await scanSources([source], { fetcher: async () => { calls++; return response; } });
    assert.equal(calls, 1);
    assert.equal(scanCoverage([source], scan, []).partial, true);
    assert.equal(scan.documents.length, 0);
  }
});

test('budget esaurito non finge richieste e fonti troppo grandi non entrano nel prompt', async () => {
  const scan = await scanSources([source], { budgetMs: 0, fetcher: () => { throw Error('Must not fetch'); } });
  assert.deepEqual(scanCoverage([source], scan, []).attemptedBrands, []);
  const large = await scanSources([source], { maxBytes: 50, fetcher: async () => html(body) });
  assert.equal(large.reports[0].receipts[0].status, 'too_large');
});

test('solo HTTPS di brand e gruppi autorizzati, niente credenziali o URL senza limite', () => {
  for (const url of ['http://prada.com/news', 'https://prada.com.evil.test/news', 'https://user:pass@prada.com/news', 'https://prada.com:9999/news', 'https://prada.com/' + 'x'.repeat(1900)]) assert.equal(officialUrl(url, source), null);
  assert.ok(matchesCompetitor({ brand: 'Prada', url: 'https://www.pradagroup.com/en/news/prada' }, [source]));
  assert.equal(matchesCompetitor({ brand: 'Prada', url: 'https://www.kering.com/news/prada' }, [source]), false);
});

test('date esplicite valide, non eventi, modifica, copyright o metadati di altri articoli', () => {
  assert.deepEqual(publishedMetadata('<script type="application/ld+json">{"@type":"Event","startDate":"2026-09-30","dateModified":"2026-09-30"}</script>'), []);
  assert.deepEqual(publishedMetadata('<meta property="article:published_time" content="2026-09-30bad">'), []);
  assert.deepEqual(publishedMetadata('<meta property="article:published_time" content="2026-09-30T08:10:00Z">'), ['2026-09-30T08:10:00Z']);
  const graph = '<script type="application/ld+json">{"@graph":[{"@type":"Article","url":"https://prada.com/news/other","datePublished":"2026-09-30"}]}</script>';
  assert.deepEqual(publishedMetadata(graph, 'https://prada.com/news/current'), []);
});

test('il menu di un gruppo non attribuisce a Prada la notizia di un altro brand', async () => {
  const parent = { ...source, urls: ['https://pradagroup.com/news'] };
  const content = '<nav><a href="/news/prada">Prada</a></nav><main>' + 'Novità di un altro marchio. '.repeat(30) + '</main>';
  const scan = await scanSources([parent], { fetcher: async () => html(content) });
  assert.equal(scanCoverage([parent], scan, []).consultedBrands.length, 0);
  assert.equal(extractPage(content, parent.urls[0], parent).links.length, 0);
});

test('prompt limitato ma tutti i brand mantengono il proprio esito', () => {
  const reports = Array.from({ length: 33 }, (_, i) => ({ brand: 'Brand' + i, status: 'unavailable' }));
  const documents = reports.flatMap(r => Array.from({ length: 4 }, () => ({ brand: r.brand, url: 'https://example.com/' + 'x'.repeat(1700), title: 'x'.repeat(180), text: 'x'.repeat(2500), publicationMetadata: [], links: [] })));
  const prompt = scanBrief({ reports, documents });
  assert.ok(prompt.length < 33000);
  for (const report of reports) assert.ok(prompt.includes('"brand":"' + report.brand + '"'));
});

test('48 ore sovrapposte recuperano indicizzazione tardiva senza deriva o date future', () => {
  const now = new Date('2026-09-30T08:30:00Z');
  const window = radarWindow(now);
  assert.equal(window.since, '2026-09-28T08:30:00.000Z');
  assert.equal(radarWindow(new Date('2026-10-01T08:30:00Z')).since, '2026-09-29T08:30:00.000Z');
  const item = { publishedOn: '2026-09-29', publicationEvidence: 'Pubblicato il 29 settembre 2026' };
  assert.equal(verifyPublication(item, window).publishedOn, '2026-09-29');
  assert.throws(() => verifyPublication({ ...item, publishedOn: '2026-09-20' }, window));
});

test('notizia Globale accettata in USA, copertura parziale non avanza il checkpoint', () => {
  const now = new Date('2026-09-30T08:30:00Z');
  const item = { scope: 'new_york', brand: 'Prada', category: 'campagna', publishedOn: '2026-09-30', publishedAt: null,
    publicationEvidence: 'Comunicato pubblicato il 30 settembre 2026', dateOrSeason: 'Autunno 2026', geography: 'Globale', geographyEvidence: 'La fonte presenta la nuova campagna internazionale, senza attivazione USA dichiarata.',
    title: 'Campagna internazionale di test', fact: 'Un fatto di test, non destinato alla pubblicazione reale.', communication: 'Una lettura creativa sintetica destinata esclusivamente al test.', relevance: 'Uno spunto di analisi comparativa destinato esclusivamente al test.', source: 'Prada test', url: 'https://prada.com/news/campaign' };
  const result = buildNewYorkDesk({ draft: { updates: [item] }, sourceUrls: [item.url], domains: ['prada.com'], competitors: [source], seenUrls: [], now, today: '2026-09-30', window: radarWindow(now), coverage: { partial: true }, previous: { updates: [], lastSuccessfulSearchAt: '2026-09-28T08:30:00Z' } });
  assert.equal(result.desk.updates[0].geography, 'Globale');
  assert.equal(result.desk.lastSuccessfulSearchAt, '2026-09-28T08:30:00Z');
});

test('watchlist completa con un indice esplicito per ciascuna maison', async () => {
  const sources = JSON.parse(await readFile(new URL('../config/competitors.json', import.meta.url), 'utf8'));
  assert.equal(sources.length, 33);
  for (const source of sources) assert.ok(source.urls.length && source.urls.every(url => officialUrl(url, source)));
});
