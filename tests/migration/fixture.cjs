// Synthetic source data: safe to import into disposable migration test databases.
const at = hour => `2026-10-01T${String(hour).padStart(2, '0')}:00:00.000Z`;
const alice = { name: 'Алиса,"雪"', class: 'Sorcerer', clan: 'Alpha', clan_crest: '/alpha.png', rank: 2, level: 70, pvp: 100, pk: 0, online: '1h' };
const alpha = { name: 'Alpha', leader: 'Leader', rank: 1, pvp: 1000, pk: 0, members: 20, avg_level: 70, reputation: 10, clanHall: 'Onyx Hall (Gludio)' };
const hall = (location, owner_clan) => ({ name: 'Onyx Hall', location, owner_clan, owner_crest: null });
const snapshot = (serverKey, hour, players, clans, extra = {}) => ({
  id: `${serverKey}-${hour}`, serverKey, server: `Lu4 - ${serverKey[0].toUpperCase()}${serverKey.slice(1)}`,
  capturedAt: at(hour), players, clans, castles: [], clanHalls: [], ...extra,
});
const collections = [
  snapshot('gamma', 0, [alice, { name: 'Leaving', rank: 3, pvp: 50, pk: null, clan: 'Alpha' }], [alpha, { name: 'Historical', rank: 2 }], { clanHalls: [hall('Gludio', 'Alpha'), hall('Gludin', null)] }),
  snapshot('gamma', 1, [alice, { name: 'Leaving', rank: 3, pvp: 50, pk: null, clan: 'Alpha' }], [alpha, { name: 'Historical', rank: 2 }], { clanHalls: [hall('Gludio', 'Alpha'), hall('Gludin', null)] }),
  snapshot('gamma', 3, [
    { ...alice, rank: 1, pvp: 125, pk: 2, clan: 'Beta', clan_crest: '/beta.png' },
    { name: 'New', rank: 2, pvp: 0, pk: 0, clan: 'Beta', class: 'Gladiator' },
    { name: 'EXP', rank: 1000, pvp: null, pk: null, clan: 'Beta' },
  ], [{ ...alpha, pvp: 900, pk: 1, members: 19, clanHall: null }, { name: 'Beta', rank: 2 }], {
    castles: [{ name: 'Giran', owner_clan: 'Outside Rankings', tax: '15%', next_siege: '2026-10-04T20:00:00Z', attackers: [{ name: 'Beta', leader: 'Бета', crest: '/beta.png' }], defenders: [], territory_wards: '2' }],
    clanHalls: [hall('Gludio', null), hall('Gludin', 'Outside Rankings')],
  }),
  snapshot('gamma', 6, [{ name: 'New', rank: 1, pvp: 0, pk: 0, clan: 'Beta' }], [{ name: 'Beta', rank: 1 }], { clanHalls: [hall('Gludio', null), hall('Gludin', 'Outside Rankings')] }),
  snapshot('gamma', 9, [{ ...alice, pvp: 90, pk: 0, clan: null, clan_crest: null }], [alpha], {
    castles: [{ name: 'Giran', owner_clan: null, attackers: [], defenders: [] }],
    clanHalls: [hall('Gludio', 'Outside Rankings'), hall('Gludin', null)],
  }),
  snapshot('white', 0, [{ ...alice, pvp: 9000, clan: 'White Clan' }], [{ name: 'Alpha', pvp: 90000 }]),
  snapshot('white', 9, [{ ...alice, pvp: 9001, clan: 'White Clan' }], [{ name: 'Alpha', pvp: 90001 }]),
];
module.exports = { collections, at, playerName: alice.name };
