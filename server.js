const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

// Supabase client for PM persistence
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check for hosting platforms
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Rutas de autenticación
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Rutas del juego (save/load)
const gameRoutes = require('./routes/game');
app.use('/api/game', gameRoutes);

// Rutas de alianzas
const allianceRoutes = require('./routes/alliance');
app.use('/api/alliance', allianceRoutes);

// Serve game files from /public subfolder
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   💬 GLOBAL CHAT
============================================================ */
const chatHistory = [];      // Last 50 messages in memory
const MAX_HISTORY = 50;
let onlineUsers = new Map(); // socketId -> username

io.on('connection', (socket) => {
  console.log('Jugador conectado:', socket.id);

  // Player joins chat
  socket.on('chat_join', (data) => {
    const username = (data.username || 'Anonymous').substring(0, 20);
    onlineUsers.set(socket.id, username);
    
    // Send recent history to new user
    socket.emit('chat_history', chatHistory);
    
    // Broadcast online count
    io.emit('chat_online', onlineUsers.size);
    
    // System message
    const joinMsg = { type: 'system', text: `${username} joined`, timestamp: Date.now() };
    chatHistory.push(joinMsg);
    if(chatHistory.length > MAX_HISTORY) chatHistory.shift();
    io.emit('chat_message', joinMsg);
    
    console.log(`💬 ${username} joined chat (${onlineUsers.size} online)`);
  });

  // Chat message
  socket.on('chat_message', (data) => {
    const username = onlineUsers.get(socket.id) || 'Anonymous';
    const text = (data.text || '').substring(0, 200).trim();
    if(!text) return;
    
    const msg = {
      username,
      text,
      timestamp: Date.now()
    };
    
    chatHistory.push(msg);
    if(chatHistory.length > MAX_HISTORY) chatHistory.shift();
    
    // Broadcast to everyone
    io.emit('chat_message', msg);
  });

  // PvP attack notification
  socket.on('pvp_attack', (data) => {
    // Broadcast to all — the defender's client will check if it's for them
    io.emit('pvp_attacked', data);
    console.log(`⚔️ PvP: ${data.attackerName} attacked ${data.defenderName}`);
  });

  /* ========================================================
     ✉️ PRIVATE MESSAGES
  ======================================================== */

  // Send a PM
  socket.on('pm_send', async (data, ack) => {
    const from = onlineUsers.get(socket.id);
    if (!from) return ack?.({ ok: false, error: 'Not identified' });

    const to = (data.to || '').trim().substring(0, 20);
    const text = (data.text || '').trim().substring(0, 500);
    if (!to || !text) return ack?.({ ok: false, error: 'Missing to/text' });
    if (to.toLowerCase() === from.toLowerCase()) return ack?.({ ok: false, error: 'Cannot PM yourself' });

    // Persist to Supabase
    const { data: row, error } = await supabase
      .from('private_messages')
      .insert([{ from_username: from, to_username: to, text }])
      .select()
      .single();

    if (error) {
      console.error('PM SAVE ERROR:', error);
      return ack?.({ ok: false, error: 'Could not save message' });
    }

    const msg = {
      id: row.id,
      from: from,
      to: to,
      text: text,
      created_at: row.created_at,
      is_read: false
    };

    // Deliver in real-time to recipient if online
    for (const [sid, uname] of onlineUsers.entries()) {
      if (uname.toLowerCase() === to.toLowerCase()) {
        io.to(sid).emit('pm_incoming', msg);
      }
    }

    console.log(`✉️ PM: ${from} → ${to}`);
    ack?.({ ok: true, msg });
  });

  // Fetch conversations list (last message + unread count per partner)
  socket.on('pm_conversations', async (data, ack) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return ack?.({ ok: false, error: 'Not identified' });

    const { data: msgs, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`from_username.eq.${me},to_username.eq.${me}`)
      .order('created_at', { ascending: false });

    if (error) { console.error('PM CONV ERROR:', error); return ack?.({ ok: false, error: 'DB error' }); }

    // Group by partner
    const convMap = {};
    for (const m of (msgs || [])) {
      const partner = m.from_username.toLowerCase() === me.toLowerCase() ? m.to_username : m.from_username;
      const key = partner.toLowerCase();
      if (!convMap[key]) {
        convMap[key] = {
          partner: partner,
          lastMessage: m.text,
          lastDate: m.created_at,
          unread: 0
        };
      }
      // Count unread (messages sent TO me that are not read)
      if (m.to_username.toLowerCase() === me.toLowerCase() && !m.is_read) {
        convMap[key].unread++;
      }
    }

    const conversations = Object.values(convMap).sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
    ack?.({ ok: true, conversations });
  });

  // Fetch thread with a specific user
  socket.on('pm_thread', async (data, ack) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return ack?.({ ok: false, error: 'Not identified' });

    const partner = (data.with || '').trim();
    if (!partner) return ack?.({ ok: false, error: 'Missing partner' });

    const { data: msgs, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`and(from_username.eq.${me},to_username.eq.${partner}),and(from_username.eq.${partner},to_username.eq.${me})`)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) { console.error('PM THREAD ERROR:', error); return ack?.({ ok: false, error: 'DB error' }); }

    // Mark incoming as read
    await supabase
      .from('private_messages')
      .update({ is_read: true })
      .eq('from_username', partner)
      .eq('to_username', me)
      .eq('is_read', false);

    ack?.({ ok: true, messages: msgs || [] });
  });

  // Mark all messages from a partner as read
  socket.on('pm_mark_read', async (data, ack) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return ack?.({ ok: false, error: 'Not identified' });

    const partner = (data.from || '').trim();
    if (!partner) return ack?.({ ok: false });

    await supabase
      .from('private_messages')
      .update({ is_read: true })
      .eq('from_username', partner)
      .eq('to_username', me)
      .eq('is_read', false);

    ack?.({ ok: true });
  });

  // Get total unread PM count
  socket.on('pm_unread_count', async (data, ack) => {
    const me = onlineUsers.get(socket.id);
    if (!me) return ack?.({ ok: false, error: 'Not identified' });

    const { count, error } = await supabase
      .from('private_messages')
      .select('id', { count: 'exact', head: true })
      .eq('to_username', me)
      .eq('is_read', false);

    ack?.({ ok: true, count: count || 0 });
  });

  socket.on('disconnect', () => {
    const username = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    
    // Broadcast online count
    io.emit('chat_online', onlineUsers.size);
    
    if(username){
      const leaveMsg = { type: 'system', text: `${username} left`, timestamp: Date.now() };
      chatHistory.push(leaveMsg);
      if(chatHistory.length > MAX_HISTORY) chatHistory.shift();
      io.emit('chat_message', leaveMsg);
      console.log(`💬 ${username} left chat (${onlineUsers.size} online)`);
    }
    
    console.log('Jugador desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ATLANTIS server running on port ${PORT}`);
});