import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { parseClanHallTable, applyClanHallOwners } from '../parser.js';

for (const headers of [['Clan Hall', 'Location', 'Clan'], ['Обитель клана', 'Локация', 'Клан']]) {
  test(`clan hall ownership: ${headers[0]}`, () => {
    const html = `<table><thead><tr><th>#</th>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      <tr><td>1</td><td>Onyx Hall</td><td>Gludio</td><td title="Leader: Someone"><img src="/images/crest/1.png">Akatsuki</td></tr>
      <tr><td>2</td><td>Onyx Hall</td><td>Gludin</td><td title="Leader: "></td></tr></tbody></table>`;
    const halls = parseClanHallTable(cheerio.load(html));
    assert.equal(halls.length, 2);
    assert.equal(halls[0].owner_clan, 'Akatsuki');
    assert.equal(halls[0].owner_crest, '/images/crest/1.png');
    assert.equal(halls[1].owner_clan, null);
    const clans = [{ name: 'AKATSUKI', clanHall: '-' }, { name: 'OldOwner', clanHall: 'Stale hall' }];
    applyClanHallOwners(clans, halls);
    assert.equal(clans[0].clanHall, 'Onyx Hall (Gludio)');
    assert.equal(clans[1].clanHall, null);
  });
}
