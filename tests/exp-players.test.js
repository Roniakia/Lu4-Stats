import assert from 'node:assert/strict';
import test from 'node:test';
import * as cheerio from 'cheerio';
import { mergeExpPlayers, parseExpPlayers } from '../parser.js';

// EXP uses responsive CSS to hide desktop columns, but their data remains in HTML.
const html = `<body>
<div>1\n zxc67 (Lv. 75)\n Destroyer · 30 PvP, 3 PK\n</div>
<div>2\n LoLPanic (Lv. 75)\n Spellsinger · 1566 PvP, 1 PK\n</div>
<div>3\n Baileeshka (Lv. 75)\n Elven Elder · 4 PvP, 0 PK\n</div>
<table><thead><tr><th>#</th><th>Character</th><th class="d-none d-md-table-cell">Class</th><th class="d-none d-md-table-cell">Clan</th><th>Level</th><th class="d-none d-md-table-cell">PvP / PK</th><th class="d-none d-md-table-cell">Online</th></tr></thead>
<tbody><tr><td>4</td><td>WINI <span class="online-badge badge bg-danger"></span><div class="d-md-none">Spellsinger</div></td><td class="d-none d-md-table-cell">Spellsinger</td><td class="d-none d-md-table-cell"><span class="crest"><img src="/images/crest/23767-10.png"></span>TheRedTerror</td><td>75</td><td class="d-none d-md-table-cell">962 / 1</td><td class="d-none d-md-table-cell">59 d. 9 h.</td></tr></tbody></table></body>`;

test('EXP parses featured cards and responsive table PvP/PK', () => {
  const players = parseExpPlayers(cheerio.load(html));
  assert.equal(players.length, 4);
  assert.deepEqual(players.map(p => [p.name, p.pvp, p.pk]), [['zxc67',30,3],['LoLPanic',1566,1],['Baileeshka',4,0],['WINI',962,1]]);
  assert.equal(players[3].class, 'Spellsinger');
  assert.equal(players[3].clan, 'TheRedTerror');
  assert.equal(players[3].crest, '/images/crest/23767-10.png');
  assert.equal(players[3].online, '59 d. 9 h.');
});

test('EXP-only players follow unchanged PvP players, sorted by PvP from rank 1000', () => {
  const exp = parseExpPlayers(cheerio.load(html));
  const pvp = [{ ...exp[1], rank: 1 }, { ...exp[0], name: 'ZXC67', rank: 100 }];
  const before = JSON.stringify({pvp, exp});
  const result = mergeExpPlayers(pvp, exp);
  assert.deepEqual(result.map(p => [p.name, p.rank, p.pvp]), [['LoLPanic',1,1566],['ZXC67',100,30],['WINI',1000,962],['Baileeshka',1001,4]]);
  assert.equal(result[0], pvp[0]);
  assert.equal(result[1], pvp[1]);
  assert.deepEqual(Object.keys(result[2]), Object.keys(exp[3]));
  assert.equal(JSON.stringify({pvp, exp}), before);
});

const featuredCard = (name, rank, crest) => `<div class="hero-content"><div>${rank}\n${crest ? `<span class="crest"><img src="${crest}"></span>` : ''}<b>${name}</b> (Lv. 75)\n</div><small>Bishop · ${rank} PvP, 0 PK</small>\n</div>`;

test('featured players get only their own crest, never a sibling card crest', () => {
  const page = `<body><section>${featuredCard('AnnaLong', 1, '/images/crest/first.png')}${featuredCard('Anna', 2, '/images/crest/second.png')}${featuredCard('NoClan', 3, null)}</section></body>`;
  const players = parseExpPlayers(cheerio.load(page));
  assert.deepEqual(players.map(p => [p.name, p.crest]), [['AnnaLong', '/images/crest/first.png'], ['Anna', '/images/crest/second.png'], ['NoClan', null]]);
});
