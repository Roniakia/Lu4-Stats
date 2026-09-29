export const SERVERS = {
  gamma: { key: 'gamma', name: 'Lu4 - Gamma' },
  white: { key: 'white', name: 'Lu4 - White' },
  black: { key: 'black', name: 'Lu4 - Black' },
  carmine: { key: 'carmine', name: 'Lu4 - Carmine' },
};

export const SERVER_KEYS = Object.keys(SERVERS);

export function normalizeServerKey(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;

  for (const server of Object.values(SERVERS)) {
    if (
      text === server.key ||
      text === server.name.toLowerCase() ||
      text === server.name.replace(/^Lu4 - /i, '').toLowerCase() ||
      text.includes(server.key)
    ) {
      return server.key;
    }
  }

  return null;
}

export function serverName(serverKey) {
  return SERVERS[serverKey]?.name ?? serverKey;
}
