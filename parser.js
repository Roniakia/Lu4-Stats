import { log } from './logger.js';
import { MW2_BASE_URL, MW2_USER_AGENT } from './config.js';
import * as cheerio from 'cheerio';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { SERVER_KEYS, SERVERS, normalizeServerKey } from './servers.js';

const BASE_URL = MW2_BASE_URL;
const RATING_URL = `${BASE_URL}/panel/rating/index?type=pvp`;
const EXP_URL = `${BASE_URL}/panel/rating/index?type=exp`;
const CLAN_PVP_URL = `${BASE_URL}/panel/rating/index?type=clan-pvp`;
const CASTLE_URL = `${BASE_URL}/panel/rating/index?type=castle`;
const MIN_RATING_PAGE_INTERVAL_MS = 5_000;
let lastRatingPageRequestAt = 0;

const USER_AGENT = MW2_USER_AGENT;

const CLASS_NAMES = [
  'Dark Avenger', 'Temple Knight', 'Shillien Knight', 'Elven Elder',
  'Shillien Elder', 'Phantom Ranger', 'Silver Ranger', 'Plains Walker',
  'Abyss Walker', 'Treasure Hunter', 'Bounty Hunter', 'Elemental Summoner',
  'Phantom Summoner', 'Soul Breaker', 'Swordsinger', 'Bladedancer',
  'Spellsinger', 'Spellhowler', 'Necromancer', 'Warlock', 'Sorcerer',
  'Gladiator', 'Warlord', 'Destroyer', 'Tyrant', 'Overlord', 'Warcryer',
  'Bishop', 'Prophet', 'Paladin', 'Berserker', 'Inspector', 'Judicator',
  'Hawkeye', 'Warsmith', 'Dark Elf Fighter', 'Terramancer',
].sort((a, b) => b.length - a.length);

function clean(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function cellText($, cell) {
  const text = clean($(cell).text());
  if (text) return text;

  const attributes = [
    $(cell).attr('aria-label'),
    $(cell).attr('title'),
    $(cell).find('[aria-label]').first().attr('aria-label'),
    $(cell).find('[title]').first().attr('title'),
    $(cell).find('img[alt]').first().attr('alt'),
  ];

  for (const value of attributes) {
    const result = clean(value);
    if (result) return result;
  }

  return '';
}

function number(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text.replace(/[^0-9-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function splitCharacter(value, explicitClass = null) {
  const text = clean(value);
  const className = clean(explicitClass);
  if (className) {
    const classStart = text.length - className.length;
    if (
      classStart > 0
      && /\s/.test(text[classStart - 1])
      && text.slice(classStart).toLowerCase() === className.toLowerCase()
    ) {
      return { name: text.slice(0, classStart).trim(), class: className };
    }
    return { name: text, class: className };
  }

  for (const className of CLASS_NAMES) {
    const suffix = ` ${className}`;
    if (text.endsWith(suffix)) {
      return {
        name: text.slice(0, -suffix.length).trim(),
        class: className,
      };
    }
  }
  return { name: text, class: null };
}

function detectServerFromText(text) {
  const normalized = clean(text);
  const match = normalized.match(/[·•]\s*(Lu4\s*-\s*(?:Gamma|White|Black|Carmine))/i);
  return match ? match[1] : null;
}

function parseFeaturedPlayers($) {
  const lines = $('body').text().split(/\n/).map(clean).filter(Boolean);
  const players = [];

  for (let i = 0; i < lines.length - 2; i++) {
    const rank = number(lines[i]);
    if (!Number.isInteger(rank) || rank < 1 || rank > 3) continue;

    const playerMatch = lines[i + 1].match(/^(.+?)\s*\(Lv\.\s*(\d+)\)$/i);
    const statsMatch = lines[i + 2].match(/^(.+?)\s*[·•]\s*([\d,\s]+)\s+PvP,\s*([\d,\s]+)\s+PK$/i);
    if (!playerMatch || !statsMatch) continue;

    players.push({
      rank,
      name: clean(playerMatch[1]),
      level: Number(playerMatch[2]),
      class: clean(statsMatch[1]),
      clan: null,
      crest: playerCrest($, clean(playerMatch[1])),
      pvp: number(statsMatch[2]),
      pk: number(statsMatch[3]),
      online: null,
    });
  }

  return players;
}

function normalizeHeader(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ');
}

function headerIndex(headers, patterns) {
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    return patterns.some((pattern) => pattern.test(normalized));
  });
}

function parsePvpPk(value) {
  const match = clean(value).match(/([\d,\s]+)\s*\/\s*([\d,\s]+)/);
  if (!match) return { pvp: null, pk: null };
  return {
    pvp: number(match[1]),
    pk: number(match[2]),
  };
}

function rowCells($, row) {
  return $(row)
    .children('td, th, [role="cell"], [role="gridcell"]')
    .map((_, cell) => cellText($, cell))
    .get();
}

// MW2 sometimes omits the clan name from a player row while still rendering
// the clan crest. Use the crest image URL as a stable join key across the two
// rating pages (ignore query strings and host aliases).
function crestKey($, cell) {
  const image = $(cell).is('img') ? $(cell) : $(cell).find('img').first();
  const link = $(cell).is('a')
    ? $(cell)
    : $(cell).closest('a[href*="/images/crest/"]').add($(cell).find('a[href*="/images/crest/"]').first()).first();
  const value = link.attr('href')
    ?? image.attr('src')
    ?? image.attr('data-src')
    ?? image.attr('data-lazy-src');
  if (!value) return null;
  try {
    const url = new URL(value, BASE_URL);
    return url.pathname.replace(/\/+$/, '').toLowerCase() || null;
  } catch {
    return clean(value).toLowerCase() || null;
  }
}

function titleFromCell($, cell) {
  if (!cell) return null;
  const $cell = $(cell);
  const nestedTitles = $cell.find('[title]').map((_, element) => $(element).attr('title')).get();
  const title = [$cell.attr('title'), ...nestedTitles].map(clean).find(Boolean);
  return title?.replace(/^leader\s*:\s*/i, '').trim() || null;
}

function playerCrest($, playerName) {
  let crest = null;
  const target = playerName.toLowerCase();
  $('a[href*="/images/crest/"], img[src*="/images/crest/"], img[data-src*="/images/crest/"]').each((_, node) => {
    if (crest) return;
    let current = $(node);
    for (let depth = 0; depth < 18 && current.length; depth++, current = current.parent()) {
      if (clean(current.text()).toLowerCase().includes(target)) {
        crest = crestKey($, node);
        break;
      }
    }
  });
  return crest;
}

function parsePlayerRows($, rows, headerRowIndex = 0) {
  if (!rows.length) return [];

  const headerCandidates = rows.slice(Math.max(0, headerRowIndex - 2), Math.min(rows.length, headerRowIndex + 3));
  let best = null;

  for (let i = 0; i < headerCandidates.length; i++) {
    const actualIndex = Math.max(0, headerRowIndex - 2) + i;
    const headers = rowCells($, rows[actualIndex]).map(normalizeHeader);
    const score = [
      /^#$/, /^rank$/,
      /^character$/,
      /^class$/,
      /^clan$/,
      /^level$/,
      /^pvp\s*\/\s*pk$/,
      /^online$/,
    ].filter((pattern) => headers.some((h) => pattern.test(h))).length;

    if (!best || score > best.score) best = { index: actualIndex, headers, score };
  }

  if (!best || best.score < 3) return [];

  const headers = best.headers;
  const rankIndex = headerIndex(headers, [/^#$/, /^rank$/]);
  const characterIndex = headerIndex(headers, [/^character$/]);
  const classIndex = headerIndex(headers, [/^class$/]);
  const clanIndex = headerIndex(headers, [/^clan$/]);
  const levelIndex = headerIndex(headers, [/^level$/]);
  const pvpPkIndex = headerIndex(headers, [/^pvp\s*\/\s*pk$/, /^pvp\s*pk$/, /pvp\s*\/\s*pk/]);
  const onlineIndex = headerIndex(headers, [/^online$/]);

  const players = [];

  for (const row of rows.slice(best.index + 1)) {
    const cells = rowCells($, row);
    if (!cells.length) continue;

    const rank = number(cells[rankIndex]);
    if (rank === null || rank < 1 || rank > 1000) continue;

    const character = cells[characterIndex] ?? '';
    if (!character) continue;

    const explicitClass = classIndex >= 0 ? cells[classIndex] || null : null;
    const clan = clanIndex >= 0 ? cells[clanIndex] || null : null;
    const crest = clanIndex >= 0 ? crestKey($, $(row).children('td, th, [role="cell"], [role="gridcell"]').get(clanIndex)) : null;
    const level = levelIndex >= 0 ? number(cells[levelIndex]) : null;
    const pvpPk = pvpPkIndex >= 0 ? parsePvpPk(cells[pvpPkIndex]) : { pvp: null, pk: null };
    const online = onlineIndex >= 0 ? cells[onlineIndex] || null : null;

    const split = splitCharacter(character, explicitClass);

    players.push({
      rank,
      name: split.name,
      level,
      class: explicitClass ?? split.class,
      clan,
      crest,
      pvp: pvpPk.pvp,
      pk: pvpPk.pk,
      online,
    });
  }

  return players;
}

function parsePlayerTable($) {
  let players = [];

  // Normal HTML tables. Look for the header row instead of assuming it is
  // always the first <tr>; MW2 has had several layouts over time.
  $('table').each((_, table) => {
    if (players.length) return;

    const rows = $(table).find('tr').toArray();
    if (!rows.length) return;

    for (let start = 0; start < Math.min(rows.length, 12); start++) {
      const candidate = parsePlayerRows($, rows, start);
      if (candidate.length) {
        players = candidate;
        return;
      }
    }
  });

  // ARIA/grid based tables.
  if (!players.length) {
    const rowNodes = $('[role="row"]').toArray();
    for (let start = 0; start < Math.min(rowNodes.length, 12); start++) {
      const candidate = parsePlayerRows($, rowNodes, start);
      if (candidate.length) {
        players = candidate;
        break;
      }
    }
  }

  // Last-resort positional parser for the exact rating table shown by MW2:
  // # | Character | Class | Clan | Level | PvP / PK | Online
  // This is intentionally independent of <thead>/<tbody> markup.
  if (!players.length) {
    $('table tr, [role="row"]').each((_, row) => {
      const cells = rowCells($, row);
      if (cells.length < 6) return;

      const rank = number(cells[0]);
      const level = number(cells[4]);
      const pvpPk = parsePvpPk(cells[5]);
      if (rank === null || rank < 1 || level === null || pvpPk.pvp === null) return;
      if (!cells[1]) return;
      const split = splitCharacter(cells[1], cells[2]);

      players.push({
        rank,
        name: split.name,
        class: split.class,
        clan: clean(cells[3]) || null,
        crest: crestKey($, $(row).children('td, th, [role="cell"], [role="gridcell"]').get(3)),
        level,
        pvp: pvpPk.pvp,
        pk: pvpPk.pk,
        online: clean(cells[6]) || null,
      });
    });
  }

  // De-duplicate by rank in case both table and ARIA parsing saw the same row.
  const byRank = new Map();
  for (const player of players) byRank.set(player.rank, player);
  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

function parseClanTable($) {
  const clans = [];

  // Rank | Name | Alliance | Castle | Clan Hall | Level | Reputation |
  // PvP / PK | Members | Avg. Level
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td').map((__, cell) => clean($(cell).text())).get();
    if (cells.length < 10) return;

    const rank = number(cells[0]);
    const level = number(cells[5]);
    const reputation = number(cells[6]);
    const pvpPk = cells[7].match(/([\d,\s]+)\s*\/\s*([\d,\s]+)/);
    const members = number(cells[8]);
    const avgLevel = number(cells[9]);

    const castle = cells[3] || null;
    const rawName = clean(cells[1]);
    const cellsInRow = $(row).find('td').toArray();
    const nameCell = cellsInRow[1];
    const crestCell = cellsInRow.find((cell) => crestKey($, cell)) ?? nameCell;
    const leader = titleFromCell($, crestCell) ?? titleFromCell($, nameCell);
    const name = castle && castle !== '-'
      && rawName.toLowerCase().endsWith(` ${castle.toLowerCase()}`)
      ? rawName.slice(0, -(castle.length + 1)).trim()
      : rawName;

    if (rank === null || !pvpPk || !name) return;

    clans.push({
      rank,
      name,
      leader,
      crest: crestKey($, crestCell),
      alliance: cells[2] || null,
      castle,
      clanHall: cells[4] || null,
      level,
      reputation,
      pvp: number(pvpPk[1]),
      pk: number(pvpPk[2]),
      members,
      avgLevel,
    });
  });

  return clans;
}

function parseCastleParticipants($, cell, clanLeaders) {
  const participants = [];
  $(cell).find('span.crest').each((_, crestNode) => {
    let trailingText = '';
    for (let sibling = crestNode.nextSibling; sibling; sibling = sibling.nextSibling) {
      if (sibling.type === 'tag' && $(sibling).is('span.crest')) break;
      trailingText += sibling.type === 'text' ? sibling.data : $(sibling).text();
    }
    const name = clean(trailingText);
    if (!name) return;
    participants.push({
      name,
      crest: crestKey($, crestNode),
      leader: clanLeaders.get(name.toLowerCase()) ?? null,
    });
  });
  return participants;
}

function parseCastleCards($, clans) {
  const clanLeaders = new Map(clans
    .filter(clan => clan.name && clan.leader)
    .map(clan => [clan.name.trim().toLowerCase(), clan.leader]));
  const castles = [];

  $('.block.block-rounded .bg-image').each((_, backgroundNode) => {
    const $card = $(backgroundNode).closest('.block.block-rounded');
    const name = clean($card.find('.fw-semibold.text-white.mb-1').first().text());
    if (!name) return;

    const backgroundStyle = $(backgroundNode).attr('style') ?? '';
    const background = backgroundStyle.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i)?.[1] ?? null;
    const ownerCell = $card.find('.fs-sm.text-white-75').first();
    const ownerText = clean(ownerCell.text());
    const ownerParts = ownerText.split(/\s*[·•]\s*/).map(clean).filter(Boolean);
    const ownerClan = ownerParts[0] ?? null;
    const ownerLeader = ownerParts[1] ?? clanLeaders.get((ownerClan ?? '').toLowerCase()) ?? null;
    const ownerCrest = crestKey($, ownerCell);
    const fields = { nextSiege: null, tax: null, attackers: [], defenders: [], territoryWards: null };

    $card.find('table tr').each((__, row) => {
      const cells = $(row).children('td');
      const label = clean(cells.eq(0).text()).replace(/:$/, '').toLowerCase();
      const valueCell = cells.get(1);
      if (label === 'next siege') fields.nextSiege = clean($(valueCell).text()) || null;
      else if (label === 'tax') fields.tax = clean($(valueCell).text()) || null;
      else if (label === 'attackers') fields.attackers = parseCastleParticipants($, valueCell, clanLeaders);
      else if (label === 'defenders') fields.defenders = parseCastleParticipants($, valueCell, clanLeaders);
      else if (label === 'territory wards') fields.territoryWards = clean($(valueCell).text()) || null;
    });

    castles.push({
      name,
      background,
      ownerClan,
      ownerCrest,
      ownerLeader,
      ...fields,
    });
  });

  return castles;
}

async function fetchCastleData(page, serverKey, clans) {
  log(serverKey, 'Collecting castle rating');
  await openRatingPage(page, CASTLE_URL, serverKey);
  const $castles = await parsePage(page);
  const castleServer = normalizeServerKey(detectServerFromText($castles('h2').first().text()) ?? '');
  if (castleServer !== serverKey) {
    throw new Error(`Requested castles for ${serverKey}, but MW2 returned ${castleServer ?? 'unknown'}`);
  }
  const castles = parseCastleCards($castles, clans);
  if (!castles.length) throw new Error(`Parsed 0 castles for ${SERVERS[serverKey].name}`);
  log(serverKey, `Parsed ${castles.length} castles`);
  return castles;
}

function matchPlayerClans(players, clans) {
  // Clan pages occasionally omit a crest that is present beside a member on
  // the player rating page. Use that stable image path to fill the clan row.
  for (const clan of clans) {
    if (clan.crest) continue;
    const member = players.find((player) =>
      player.crest && player.clan?.trim().toLowerCase() === clan.name.trim().toLowerCase()
    );
    if (member) clan.crest = member.crest;
  }

  const clansByCrest = new Map();
  for (const clan of clans) {
    if (clan.crest && !clansByCrest.has(clan.crest)) clansByCrest.set(clan.crest, clan.name);
  }
  return players.map((player) => ({
    ...player,
    clan: player.clan || (player.crest ? clansByCrest.get(player.crest) : null) || null,
  }));
}

// Preserve PvP records and ranks; only EXP-only names receive synthetic ranks.
export function mergeExpPlayers(pvpPlayers, expPlayers) {
  const knownNames = new Set(pvpPlayers.map(player => clean(player.name).toLowerCase()));
  const additions = [];
  for (const player of expPlayers) {
    const name = clean(player.name).toLowerCase();
    if (!name || knownNames.has(name)) continue;
    knownNames.add(name);
    additions.push(player);
  }
  additions.sort((a, b) => (b.pvp ?? -1) - (a.pvp ?? -1) || a.rank - b.rank);
  return [...pvpPlayers, ...additions.map((player, index) => ({ ...player, rank: 1000 + index }))];
}

async function fetchExpPlayers(page, serverKey) {
  log(serverKey, 'Collecting EXP rating');
  await openRatingPage(page, EXP_URL, serverKey);
  const $ = await parsePage(page);
  const server = normalizeServerKey(detectServerFromText($('h2').first().text()) ?? '');
  if (server !== serverKey) {
    throw new Error(`Requested EXP for ${serverKey}, but MW2 returned ${server ?? 'unknown'}`);
  }
  const players = parseExpPlayers($);
  if (!players.length) throw new Error(`Parsed 0 EXP players for ${SERVERS[serverKey].name}`);
  log(serverKey, `Parsed ${players.length} EXP players (${players.filter(player => player.pvp !== null).length} with PvP counts)`);
  return players;
}

export function parseExpPlayers($) {
  const byRank = new Map(parseFeaturedPlayers($).map(player => [player.rank, player]));
  for (const player of parsePlayerTable($)) {
    const featured = byRank.get(player.rank);
    byRank.set(player.rank, {
      ...featured,
      ...player,
      pvp: player.pvp ?? featured?.pvp ?? null,
      pk: player.pk ?? featured?.pk ?? null,
      crest: player.crest ?? featured?.crest ?? null,
      clan: player.clan ?? featured?.clan ?? null,
    });
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

function findBrowserExecutable() {
  const candidates = [
    process.env.MW2_BROWSER_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${process.env.HOME ?? ''}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);

  const detected = candidates.find(existsSync);
  if (detected) return detected;

  const bundledBrowser = chromium.executablePath();
  return existsSync(bundledBrowser) ? bundledBrowser : null;
}

async function launchBrowser() {
  const executablePath = findBrowserExecutable();

  if (!executablePath) {
    throw new Error(
      'Could not find Chrome/Chromium. Set MW2_BROWSER_EXECUTABLE to the browser executable path.'
    );
  }

  return chromium.launch({
    executablePath,
    headless: true,
    chromiumSandbox: process.env.CHROMIUM_SANDBOX === 'true',
  });
}

async function visibleLocator(locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const candidate = locator.nth(i);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function getCurrentServer(page) {
  return page.evaluate(() => {
    const candidates = [
      document.querySelector('h1'),
      document.querySelector('h2'),
      document.body,
    ].filter(Boolean);

    for (const element of candidates) {
      const text = element.textContent ?? '';
      const match = text.match(/[·•]\s*(Lu4\s*-\s*(?:Gamma|White|Black|Carmine))/i);
      if (match) return match[1];
    }
    return null;
  });
}

async function clickServerMenuItem(page, serverName) {
  const exactText = page.getByText(serverName, { exact: true });
  const visibleExact = await visibleLocator(exactText);
  if (visibleExact) {
    await visibleExact.click();
    return;
  }

  const roleLink = await visibleLocator(page.getByRole('link', { name: serverName, exact: true }));
  if (roleLink) {
    await roleLink.click();
    return;
  }

  const roleMenuItem = await visibleLocator(page.getByRole('menuitem', { name: serverName, exact: true }));
  if (roleMenuItem) {
    await roleMenuItem.click();
    return;
  }

  throw new Error(`Could not find visible server menu item ${serverName}`);
}

async function openRatingPage(page, url, serverKey) {
  const desiredName = SERVERS[serverKey].name;

  const waitForPageInterval = Math.max(0, MIN_RATING_PAGE_INTERVAL_MS - (Date.now() - lastRatingPageRequestAt));
  if (waitForPageInterval) {
    log(serverKey, `Waiting ${waitForPageInterval}ms before next rating request`);
    await page.waitForTimeout(waitForPageInterval);
  }
  log(serverKey, `Opening ${new URL(url).searchParams.get('type')} rating`);
  lastRatingPageRequestAt = Date.now();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (response?.status() === 429) {
    const retryAfter = response.headers()['retry-after'];
    const retryMessage = retryAfter ? ` MW2 asked clients to retry after ${retryAfter}.` : '';
    throw new Error(`MW2 rate-limited snapshot collection (HTTP 429) on ${url}.${retryMessage} Stop the publisher and resume after the cooldown; no snapshots were published.`);
  }
  if (response && !response.ok()) {
    throw new Error(`MW2 returned HTTP ${response.status()} for ${url}; snapshot collection stopped without publishing.`);
  }
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

  let currentName = await getCurrentServer(page);
  if (!currentName) {
    // Some rating pages populate the server heading after the initial document
    // load. Give that client-side render a moment before treating this as a
    // missing selector/page response.
    await page.waitForFunction(
      () => /Lu4\s*-\s*(?:Gamma|White|Black|Carmine)/i.test(document.body?.innerText ?? ''),
      null,
      { timeout: 8_000 },
    ).catch(() => {});
    currentName = await getCurrentServer(page);
  }
  if (currentName === desiredName) {
    log(serverKey, `Verified selected server: ${desiredName}`);
    return;
  }
  log(serverKey, `Switching server from ${currentName ?? 'unknown'} to ${desiredName}`);

  // The server picker is still rendered as a button on the rating pages, but
  // its accessible name can differ from the heading (or the heading may not
  // have loaded yet). Match any known server name instead of requiring those
  // two bits of page text to be identical.
  const selectorName = /Lu4\s*-\s*(?:Gamma|White|Black|Carmine)/i;
  const triggerCandidates = [
    page.getByRole('button', { name: selectorName }).first(),
    page.locator('button').filter({ hasText: selectorName }).first(),
    page.locator('[role="button"]').filter({ hasText: selectorName }).first(),
    ...(currentName ? [page.getByRole('button', { name: currentName }).first()] : []),
  ];

  let trigger = null;
  for (const candidate of triggerCandidates) {
    if (await candidate.isVisible().catch(() => false)) {
      trigger = candidate;
      break;
    }
  }

  if (!trigger) {
    // The site currently renders the selector as a button. Keep a text fallback
    // for small markup changes without guessing the POST payload.
    trigger = await visibleLocator(page.getByText(currentName ?? /Lu4\s*-/i).first());
  }

  if (!trigger) {
    const diagnostics = await page.evaluate(() => ({
      title: document.title,
      bodyText: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600),
      buttons: Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
        }).map((element) => (element.innerText || element.getAttribute('aria-label') || element.textContent || '')
          .replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20),
    })).catch(() => ({ title: '', bodyText: '', buttons: [] }));
    throw new Error(`Could not find the MW2 server selector button on ${url} (HTTP ${response?.status() ?? 'unknown'}; page server: ${currentName ?? 'unknown'}; title: ${JSON.stringify(diagnostics.title)}; visible buttons: ${JSON.stringify(diagnostics.buttons)}; page text: ${JSON.stringify(diagnostics.bodyText)})`);
  }

  await trigger.click();
  await page.waitForTimeout(100);

  await clickServerMenuItem(page, desiredName);

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

  await page.waitForFunction(
    (name) => document.body.textContent?.includes(name),
    desiredName,
    { timeout: 15_000 },
  );

  currentName = await getCurrentServer(page);
  if (currentName !== desiredName) {
    throw new Error(`MW2 stayed on ${currentName ?? 'unknown server'} after selecting ${desiredName}`);
  }

  log(serverKey, `Verified selected server: ${desiredName}`);
  return page;
}

async function parsePage(page) {
  const html = await page.content();
  return cheerio.load(html);
}

export async function fetchSnapshot(serverKey) {
  if (!SERVER_KEYS.includes(serverKey)) {
    throw new Error(`Unsupported server: ${serverKey}`);
  }

  log('parser', 'Launching Chromium');
  const browser = await launchBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  try {
    log(serverKey, 'Starting snapshot: collecting clan PvP rating');
    await openRatingPage(page, CLAN_PVP_URL, serverKey);
    const $clans = await parsePage(page);
    const clanServer = normalizeServerKey(detectServerFromText($clans('h2').first().text()) ?? '');

    if (clanServer !== serverKey) {
      throw new Error(`Requested ${serverKey}, but MW2 returned ${detectServerFromText($clans('h2').first().text()) ?? 'unknown'}`);
    }

    const clans = parseClanTable($clans);
    if (clans.length === 0) {
      throw new Error(`Parsed 0 clans for ${SERVERS[serverKey].name}`);
    }

    log(serverKey, `Parsed ${clans.length} clans`);
    const castles = await fetchCastleData(page, serverKey, clans);
    log(serverKey, 'Collecting player PvP rating');
    await openRatingPage(page, RATING_URL, serverKey);
    const $players = await parsePage(page);

    const featured = parseFeaturedPlayers($players);
    const tablePlayers = parsePlayerTable($players);
    const playersByRank = new Map();
    // The HTML rating table is authoritative over the featured cards.
    // Featured cards are only a fallback for a rank missing from the table.
    for (const player of featured) {
      playersByRank.set(player.rank, player);
    }
    for (const player of tablePlayers) {
      const featuredPlayer = playersByRank.get(player.rank);
      playersByRank.set(player.rank, {
        ...featuredPlayer,
        ...player,
        crest: player.crest ?? featuredPlayer?.crest ?? null,
        clan: player.clan ?? featuredPlayer?.clan ?? null,
      });
    }

    let players = matchPlayerClans([...playersByRank.values()].sort((a, b) => a.rank - b.rank), clans);
    if (players.length === 0) {
      const tables = await page.locator('table').evaluateAll((tables) => tables.map((table) => ({
        headers: Array.from(table.querySelectorAll('tr')).slice(0, 3).map((row) =>
          Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
        ),
        rows: table.querySelectorAll('tr').length,
      })));
      throw new Error(`Parsed 0 players for ${SERVERS[serverKey].name}. Table diagnostics: ${JSON.stringify(tables)}`);
    }

    log(serverKey, `Parsed ${players.length} PvP players (${featured.length} featured, ${tablePlayers.length} table rows)`);
    const pvpPlayerCount = players.length;
    players = matchPlayerClans(mergeExpPlayers(players, await fetchExpPlayers(page, serverKey)), clans);
    log(serverKey, `Snapshot complete: ${players.length} players (${players.length - pvpPlayerCount} added from EXP), ${clans.length} clans, ${castles.length} castles`);

    return {
      server: SERVERS[serverKey].name,
      serverKey,
      capturedAt: new Date().toISOString(),
      players,
      clans,
      castles,
      source: {
        players: RATING_URL,
        clans: CLAN_PVP_URL,
        castles: CASTLE_URL,
        selector: 'MW2 rendered server selector',
      },
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function fetchAllSnapshots() {
  log('parser', 'Launching Chromium');
  const browser = await launchBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const results = [];

  try {
    for (const serverKey of SERVER_KEYS) {
      const page = await context.newPage();
      try {
        log(serverKey, 'Starting snapshot: collecting clan PvP rating');
        await openRatingPage(page, CLAN_PVP_URL, serverKey);
        const $clans = await parsePage(page);
        const clanServer = normalizeServerKey(detectServerFromText($clans('h2').first().text()) ?? '');
        if (clanServer !== serverKey) {
          throw new Error(`Requested ${serverKey}, but MW2 returned ${detectServerFromText($clans('h2').first().text()) ?? 'unknown'}`);
        }

        const clans = parseClanTable($clans);
        if (clans.length === 0) {
          throw new Error(`Parsed 0 clans for ${SERVERS[serverKey].name}`);
        }

        log(serverKey, `Parsed ${clans.length} clans`);
        const castles = await fetchCastleData(page, serverKey, clans);
        log(serverKey, 'Collecting player PvP rating');
        await openRatingPage(page, RATING_URL, serverKey);
        const $players = await parsePage(page);
        const featured = parseFeaturedPlayers($players);
        const tablePlayers = parsePlayerTable($players);
        const playersByRank = new Map();
        // Keep featured cards as fallback, but never overwrite a complete
        // player record from the main rating table.
        for (const player of featured) {
          playersByRank.set(player.rank, player);
        }
        for (const player of tablePlayers) {
          const featuredPlayer = playersByRank.get(player.rank);
          playersByRank.set(player.rank, {
            ...featuredPlayer,
            ...player,
            crest: player.crest ?? featuredPlayer?.crest ?? null,
            clan: player.clan ?? featuredPlayer?.clan ?? null,
          });
        }

        let players = matchPlayerClans([...playersByRank.values()].sort((a, b) => a.rank - b.rank), clans);
        if (players.length === 0) {
          const tables = await page.locator('table').evaluateAll((tables) => tables.map((table) => ({
            headers: Array.from(table.querySelectorAll('tr')).slice(0, 3).map((row) =>
              Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim())
            ),
            rows: table.querySelectorAll('tr').length,
          })));
          throw new Error(`Parsed 0 players for ${SERVERS[serverKey].name}. Table diagnostics: ${JSON.stringify(tables)}`);
        }

        log(serverKey, `Parsed ${players.length} PvP players (${featured.length} featured, ${tablePlayers.length} table rows)`);
        const pvpPlayerCount = players.length;
        players = matchPlayerClans(mergeExpPlayers(players, await fetchExpPlayers(page, serverKey)), clans);
        log(serverKey, `Snapshot complete: ${players.length} players (${players.length - pvpPlayerCount} added from EXP), ${clans.length} clans, ${castles.length} castles`);

        results.push({
          server: SERVERS[serverKey].name,
          serverKey,
          capturedAt: new Date().toISOString(),
          players,
          clans,
          castles,
          source: {
            players: RATING_URL,
            clans: CLAN_PVP_URL,
            castles: CASTLE_URL,
            selector: 'MW2 rendered server selector',
          },
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return results;
}


export async function inspectServerSelector(serverKey) {
  if (!SERVER_KEYS.includes(serverKey)) throw new Error(`Unsupported server: ${serverKey}`);

  log('parser', 'Launching Chromium');
  const browser = await launchBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  try {
    await page.goto(CLAN_PVP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

    const controls = await page.locator('button, [role="button"], a').evaluateAll((elements) =>
      elements
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
          href: element.getAttribute('href'),
          role: element.getAttribute('role'),
          visible: !!(element instanceof HTMLElement && element.offsetParent !== null),
        }))
        .filter((item) => item.visible && /Lu4\s*-/i.test(item.text)),
    );

    return {
      requestedServer: SERVERS[serverKey].name,
      currentServer: await getCurrentServer(page),
      controls,
      availableServers: Object.values(SERVERS).map((server) => server.name),
      strategy: 'Playwright clicks the rendered MW2 server menu; no guessed POST payload is used.',
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
