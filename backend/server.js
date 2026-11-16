const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log(`[+] Usuário conectado: ${socket.id}`);

    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`[Sala ${roomId}] Usuário ${socket.id} entrou.`);
        socket.to(roomId).emit('user-connected', socket.id);
    });

    socket.on('offer', (payload) => io.to(payload.target).emit('offer', payload));
    socket.on('answer', (payload) => io.to(payload.target).emit('answer', payload));
    socket.on('ice-candidate', (incoming) => io.to(incoming.target).emit('ice-candidate', incoming.candidate));

    socket.on('disconnect', () => console.log(`[-] Usuário desconectado: ${socket.id}`));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Fase 1 OK: Servidor JustCast rodando na porta ${PORT}`);
});