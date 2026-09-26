import { createHash } from 'node:crypto';
import { isExcludedBrand, matchesCompetitor, competitorCoverage } from './competitor-research.mjs';
import { researchWindow, verifyPublication } from './freshness.mjs';

const text = maxLength => ({ type: 'string', maxLength });
export const newYorkSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    updates: { type: 'array', maxItems: 10, items: {
      type: 'object', additionalProperties: false,
      properties: {
        scope: { type: 'string', enum: ['new_york'] },
        brand: text(80), category: text(60), publishedOn: { type: ['string', 'null'] },
        publishedAt: { type: ['string', 'null'] }, publicationEvidence: text(180),
        dateOrSeason: text(100), geography: { type: 'string', enum: ['New York', 'USA'] },
        geographyEvidence: text(320), title: text(160), fact: text(500),
        communication: text(420), relevance: text(320), source: text(140), url: text(1800)
      },
      required: ['scope', 'brand', 'category', 'publishedOn', 'publishedAt', 'publicationEvidence', 'dateOrSeason', 'geography',
        'geographyEvidence', 'title', 'fact', 'communication', 'relevance', 'source', 'url']
    } }
  }, required: ['updates']
};

function content(value, minimum, maximum) {
  if (typeof value !== 'string') throw Error('Testo New York mancante.');
  const result = value.replace(/\s+/g, ' ').trim();
  if (result.length < minimum || result.length > maximum) throw Error('Testo New York non valido.');
  return result;
}

export function deskUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = ''; url.search = ''; url.hostname = url.hostname.replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch { return null; }
}

function allowed(value, domains) {
  const identity = deskUrl(value);
  if (!identity) return false;
  const host = new URL(identity).hostname;
  return domains.some(domain => host === domain || host.endsWith('.' + domain));
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function failedDesk(previous, now = new Date()) {
  return { ...previous, checkedAt: now.toISOString(), updatedAt: previous?.updatedAt || null,
    status: 'error', consultedSources: [],
    updates: (previous?.updates || []).filter(item => !isExcludedBrand(item)) };
}

export function buildNewYorkDesk({ draft, sourceUrls, domains, competitors, seenUrls, previous, now, today, window = researchWindow(now, previous) }) {
  if (!draft || !Array.isArray(draft.updates) || draft.updates.length > 10) throw Error('Bozza New York non valida.');
  const sources = [...new Set(sourceUrls)].filter(url => allowed(url, domains) && !isExcludedBrand({url}));
  const consulted = new Map(sources.map(url => [deskUrl(url), url]));
  const seen = new Set([...seenUrls].map(deskUrl).filter(Boolean));
  const accepted = [];
  let rejected = 0;
  for (const item of draft.updates) {
    try {
      if (!matchesCompetitor(item, competitors)) throw Error('Brand o fonte fuori dalla watchlist.');
      const identity = deskUrl(item.url);
      if (!identity || !consulted.has(identity)) throw Error('Fonte non consultata o fuori watchlist.');
      if (seen.has(identity)) continue;
      // Undated pages, homepages and old openings are reference material, not news.
      const publication = verifyPublication(item, window);
      if (item.scope !== 'new_york' || !['New York', 'USA'].includes(item.geography)) throw Error('Ambito non valido.');
      const next = {
        id: 'ny-' + today + '-' + createHash('sha256').update(identity).digest('hex').slice(0, 12),
        addedAt: now.toISOString(), scope: item.scope,
        brand: content(item.brand, 2, 80), category: content(item.category, 3, 60),
        ...publication, dateOrSeason: content(item.dateOrSeason, 3, 100),
        geography: item.geography, geographyEvidence: content(item.geographyEvidence, 12, 320),
        title: content(item.title, 5, 160), fact: content(item.fact, 24, 500),
        communication: content(item.communication, 24, 420), relevance: content(item.relevance, 24, 320),
        source: content(item.source, 3, 140), url: consulted.get(identity)
      };
      accepted.push(next); seen.add(identity);
    } catch (error) {
      rejected++;
      console.warn('Scheda New York esclusa: ' + error.message);
    }
  }
  // New selections contain only fresh results, never a mixture with weeks-old cards.
  const updates = (accepted.length ? accepted : (previous?.updates || []).filter(item => !isExcludedBrand(item)))
    .sort((a, b) => b.publishedOn.localeCompare(a.publishedOn) || String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''))).slice(0, 10);
  const desk = {
    checkedAt: now.toISOString(), updatedAt: accepted.length ? now.toISOString() : previous?.updatedAt || null,
    status: accepted.length ? 'updated' : rejected ? 'not_verified' : sources.length ? 'no_new_verified_updates' : 'not_verified',
    freshnessPolicy: 'incremental-v1', researchWindow: window,
    lastSuccessfulSearchAt: sources.length && !rejected ? window.until : (previous?.lastSuccessfulSearchAt || window.since),
    radarCoverage: competitorCoverage(competitors, sources),
    consultedSources: sources.slice(0, 120), updates
  };
  validateNewYorkDesk(desk);
  return { desk, seenUrls: [...new Set([...seenUrls, ...accepted.map(item => item.url)])].slice(-500) };
}

export function validateNewYorkDesk(desk) {
  const statuses = ['updated', 'no_new_verified_updates', 'not_verified', 'error'];
  if (!desk || Number.isNaN(Date.parse(desk.checkedAt)) || typeof desk.checkedAt !== 'string'
    || !statuses.includes(desk.status)
    || (desk.updatedAt !== null && (typeof desk.updatedAt !== 'string' || Number.isNaN(Date.parse(desk.updatedAt))))
    || !Array.isArray(desk.updates) || desk.updates.length > 10 || !Array.isArray(desk.consultedSources)) throw Error('Stato New York non valido.');
  desk.consultedSources.forEach(url => { if (!deskUrl(url)) throw Error('Fonte New York non sicura.'); });
  if (desk.updatedAt && Date.parse(desk.updatedAt) > Date.parse(desk.checkedAt)) throw Error('Cronologia New York non valida.');
  const ids = new Set();
  for (const item of desk.updates) {
    if (!/^ny-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/.test(item.id) || ids.has(item.id)
      || !validDay(item.publishedOn) || Number.isNaN(Date.parse(item.addedAt)) || !deskUrl(item.url)
      || item.scope !== 'new_york' || !['New York', 'USA'].includes(item.geography)) throw Error('Scheda New York non valida.');
    if (!desk.updatedAt || Date.parse(item.addedAt) > Date.parse(desk.updatedAt)
      || Date.parse(item.publishedOn) > Date.parse(item.addedAt) + 86400000
      || isExcludedBrand(item)) throw Error('Fonte o cronologia della scheda non valida.');
    ids.add(item.id);
    for (const [name, min, max] of [['brand',2,80],['category',3,60],['dateOrSeason',3,100],['geographyEvidence',12,320],['title',5,160],['fact',24,500],['communication',24,420],['relevance',24,320],['source',3,140]]) content(item[name],min,max);
  }
  return desk;
}
