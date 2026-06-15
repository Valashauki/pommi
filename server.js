const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

const rooms = new Map();

function makeCode() {
  let c;
  do { c = Math.random().toString(36).substr(2, 4).toUpperCase(); } while (rooms.has(c));
  return c;
}

io.on('connection', socket => {
  socket.on('create-room', cb => {
    const code = makeCode();
    rooms.set(code, { host: socket.id, guest: null });
    socket.join(code);
    socket.data.room = code;
    socket.data.role = 'host';
    cb({ code });
  });

  socket.on('join-room', ({ code }, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ error: 'Huonetta ei löydy' });
    if (room.guest) return cb({ error: 'Huone on täynnä' });
    room.guest = socket.id;
    socket.join(code);
    socket.data.room = code;
    socket.data.role = 'guest';
    socket.to(code).emit('guest-joined');
    cb({ ok: true });
  });

  socket.on('net-state', state => {
    const code = socket.data.room;
    if (code && socket.data.role === 'host') socket.to(code).emit('net-state', state);
  });

  socket.on('net-input', data => {
    const code = socket.data.room;
    if (code && socket.data.role === 'guest') socket.to(code).emit('net-input', data);
  });

  socket.on('disconnect', () => {
    const code = socket.data.room;
    if (code) {
      socket.to(code).emit('player-left');
      rooms.delete(code);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Bombermania — port ${PORT}`));
