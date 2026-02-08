const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("client"));

// ===============================
// Room Storage
// ===============================
const rooms = {}; 
// rooms = {
//   roomCode: {
//     players: {
//        socketId: { name, life }
//     }
//   }
// }

// ===============================
// Fixed Names
// ===============================
const allowedNames = [
  "Blackman",
  "Yeasin",
  "Lamia",
  "Foyazi",
  "Minhaz",
  "Shahrin"
];

// ===============================
// Socket Connection
// ===============================
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

   socket.on("bullet", ({ roomCode, fromX, fromY, toX, toY }) => {
  if (!roomCode) return;

  io.to(roomCode).emit("bullet", {
    shooterId: socket.id,
    fromX, fromY, toX, toY
  });
});
  

  socket.on("joinRoom", ({ roomCode, name }) => {

    if (!roomCode) return;
    if (!allowedNames.includes(name)) return;

    if (!rooms[roomCode]) {
      rooms[roomCode] = { players: {} };
    }

    const room = rooms[roomCode];

    // Max 6 players check
    if (Object.keys(room.players).length >= 6) {
      socket.emit("roomFull");
      return;
    }

    // Duplicate name check
    const nameTaken = Object.values(room.players)
      .some(player => player.name === name);

    if (nameTaken) {
      socket.emit("nameTaken");
      return;
    }

    // Join room
    socket.join(roomCode);

    // random spawn (server side)
const spawn = {
  x: 60 + Math.random() * (900 - 120),
  y: 60 + Math.random() * (520 - 120)
};

room.players[socket.id] = {
  name: name,
  life: 200,
  x: spawn.x,
  y: spawn.y
};
// ===============================
// Live Movement Sync (Group)
// ===============================
socket.on("move", ({ roomCode, x, y }) => {
  if (!roomCode) return;

  const room = rooms[roomCode];
  if (!room || !room.players[socket.id]) return;

  room.players[socket.id].x = x;
  room.players[socket.id].y = y;

  io.to(roomCode).emit("playerMoved", {
    id: socket.id,
    x,
    y
  });
});


    io.to(roomCode).emit("updatePlayers", room.players);
  });

  // ===============================
  // Chat System
  // ===============================
  socket.on("chatMessage", ({ roomCode, message }) => {
    io.to(roomCode).emit("chatMessage", message);
  });

  // ===============================
  // Shoot System
  // ===============================
  socket.on("playerHit", ({ roomCode, targetId }) => {
    const room = rooms[roomCode];
    if (!room || !room.players[targetId]) return;

    room.players[targetId].life -= 1;

    if (room.players[targetId].life <= 0) {
      room.players[targetId].life = 0;
    }

    io.to(roomCode).emit("updatePlayers", room.players);
  });

  // ===============================
  // Disconnect
  // ===============================
  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      if (rooms[roomCode].players[socket.id]) {
        delete rooms[roomCode].players[socket.id];

        io.to(roomCode).emit("updatePlayers", rooms[roomCode].players);

        if (Object.keys(rooms[roomCode].players).length === 0) {
          delete rooms[roomCode];
        }
      }
    }

    console.log("User disconnected:", socket.id);
  });
});

// ===============================
// Render Port Support
// ===============================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 DEADBYTE: BLACKMAN EDITION running on port", PORT);
});
