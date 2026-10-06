// 회로 방어 온라인 서버
// 실행: npm install && npm start  →  http://localhost:3000
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createGame } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const TICK_RATE = 30;       // 초당 상태 전송 횟수
const MAX_ROOMS = 100;
const rooms = new Map();    // roomId -> { game, players:Set<socketId> }

io.on('connection', (socket) => {
  let roomId = null;

  function leave() {
    if (!roomId) return;
    const r = rooms.get(roomId);
    socket.leave(roomId);
    if (r) {
      r.players.delete(socket.id);
      if (r.players.size === 0) rooms.delete(roomId);   // 빈 방 정리
    }
    roomId = null;
  }

  socket.on('join', (data, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    leave();
    const raw = data && typeof data.room === 'string' ? data.room : '';
    const id = raw.trim().slice(0, 20) || 'lobby';
    if (!rooms.has(id)) {
      if (rooms.size >= MAX_ROOMS) return ack({ error: '서버가 가득 찼습니다' });
      rooms.set(id, { game: createGame(data && data.difficulty), players: new Set() });
    }
    rooms.get(id).players.add(socket.id);
    socket.join(id);
    roomId = id;
    ack({ room: id });
  });

  socket.on('cmd', (cmd, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    const r = roomId && rooms.get(roomId);
    if (!r) return ack({ error: '방에 입장하지 않았습니다' });
    ack(r.game.handleCommand(cmd) || {});
  });

  socket.on('disconnect', leave);
});

// 서버가 유일한 게임 시계
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  for (const [id, r] of rooms) {
    r.game.update(dt);
    io.to(id).emit('state', { ...r.game.snapshot(), players: r.players.size, room: id });
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('서버 실행 중: http://localhost:' + PORT));
