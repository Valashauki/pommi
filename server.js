const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGame } = require('./gameengine');

const ROOT = __dirname;
const SERVER_TICK_MS = 1000 / 30;
const SNAPSHOT_MS = 33;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const rawPath = req.url.split('?')[0] || '/';
  const safePath = rawPath === '/' ? '/index.html' : rawPath;
  const filePath = path.normalize(path.join(ROOT, safePath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const rooms = new Map();
const clients = new Map();
let nextClientId = 1;

function cleanName(name, fallback) {
  const out = String(name || '').trim().slice(0, 14);
  return out || fallback;
}

function makeCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms.has(c));
  return c;
}

function stopRoom(room) {
  if (room && room.loop) clearInterval(room.loop);
  if (room) room.loop = null;
}

function sendFrame(socket, text) {
  if (socket.destroyed) return;
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function send(client, type, data) {
  sendFrame(client.socket, JSON.stringify({ type, data }));
}

function ack(client, id, data) {
  if (id != null) sendFrame(client.socket, JSON.stringify({ ack: id, data }));
}

function decodeFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  const messages = [];

  while (client.buffer.length >= 2) {
    const first = client.buffer[0], second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let len = second & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (client.buffer.length < offset + 2) break;
      len = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (client.buffer.length < offset + 8) break;
      const big = client.buffer.readBigUInt64BE(offset);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Frame too large');
      len = Number(big);
      offset += 8;
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    if (client.buffer.length < offset + len) break;

    const payload = Buffer.from(client.buffer.subarray(offset, offset + len));
    if (masked) {
      const mask = client.buffer.subarray(maskOffset, maskOffset + 4);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    client.buffer = client.buffer.subarray(offset + len);

    if (opcode === 0x8) {
      client.socket.end();
      break;
    }
    if (opcode === 0x9) {
      client.socket.write(Buffer.from([0x8a, 0x00]));
      continue;
    }
    if (opcode === 0x1) messages.push(payload.toString('utf8'));
  }

  return messages;
}

function roomFor(client) {
  return client.data.room ? rooms.get(client.data.room) : null;
}

function emitSnapshot(room) {
  if (!room.game) return;
  const state = room.game.snapshot();
  for (const id of [room.host, room.guest]) {
    const client = clients.get(id);
    if (client) send(client, 'net-state', state);
  }
}

function startGame(room, settings = {}) {
  stopRoom(room);
  room.game = createGame({
    mapSize: settings.mapSize,
    difficulty: settings.difficulty,
    numBots: settings.numBots,
    playerNames: room.names,
  });

  const firstState = room.game.snapshot();
  const host = clients.get(room.host);
  const guest = clients.get(room.guest);
  if (host) send(host, 'online-started', { playerIndex: 0, state: firstState });
  if (guest) send(guest, 'online-started', { playerIndex: 1, state: firstState });

  let last = Date.now();
  let lastSnapshot = 0;
  room.loop = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    room.game.update(dt);
    if (now - lastSnapshot >= SNAPSHOT_MS) {
      emitSnapshot(room);
      lastSnapshot = now;
    }
  }, SERVER_TICK_MS);
}

function handleMessage(client, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const type = msg.type;
  const data = msg.data || {};

  if (type === 'create-room') {
    const code = makeCode();
    const room = {
      code,
      host: client.id,
      guest: null,
      names: [cleanName(data.name, 'Pelaaja'), 'Kaveri'],
      game: null,
      loop: null,
    };
    rooms.set(code, room);
    client.data.room = code;
    client.data.role = 'host';
    client.data.playerIndex = 0;
    ack(client, msg.ack, { code });
    return;
  }

  if (type === 'join-room') {
    const code = String(data.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack(client, msg.ack, { error: 'Huonetta ei loydy' });
    if (room.guest) return ack(client, msg.ack, { error: 'Huone on taynna' });

    room.guest = client.id;
    room.names[1] = cleanName(data.name, 'Kaveri');
    client.data.room = code;
    client.data.role = 'guest';
    client.data.playerIndex = 1;

    const host = clients.get(room.host);
    if (host) send(host, 'guest-joined', { name: room.names[1] });
    ack(client, msg.ack, { ok: true });
    return;
  }

  if (type === 'start-online-game') {
    const room = roomFor(client);
    if (!room || client.data.role !== 'host') return ack(client, msg.ack, { error: 'Only host can start' });
    if (!room.guest) return ack(client, msg.ack, { error: 'Odota toista pelaajaa' });
    startGame(room, data.settings || {});
    ack(client, msg.ack, { ok: true });
    return;
  }

  if (type === 'client-input') {
    const room = roomFor(client);
    if (room && room.game) room.game.setInput(client.data.playerIndex, data);
  }
}

function disconnectClient(client) {
  if (!clients.has(client.id)) return;
  clients.delete(client.id);

  const room = roomFor(client);
  if (!room) return;
  stopRoom(room);

  const otherId = room.host === client.id ? room.guest : room.host;
  const other = clients.get(otherId);
  if (other) send(other, 'player-left');
  rooms.delete(room.code);
}

server.on('upgrade', (req, socket) => {
  if ((req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }

  // Disable Nagle's algorithm: send small input/snapshot frames immediately
  // instead of buffering them for up to ~40ms.
  socket.setNoDelay(true);

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ].join('\r\n'));

  const client = {
    id: String(nextClientId++),
    socket,
    buffer: Buffer.alloc(0),
    data: {},
  };
  clients.set(client.id, client);

  socket.on('data', (chunk) => {
    try {
      for (const text of decodeFrames(client, chunk)) handleMessage(client, text);
    } catch {
      socket.destroy();
    }
  });
  socket.on('close', () => disconnectClient(client));
  socket.on('error', () => disconnectClient(client));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pommi authoritative server on port ${PORT}`));
