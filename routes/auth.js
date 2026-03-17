const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// REGISTRAR
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || username.length < 3)
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  if (!email || !email.includes('@'))
    return res.status(400).json({ error: 'Invalid email.' });
  if (!password || password.length < 4)
    return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  const hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('jugadores')
    .insert([{ username, email, password_hash: hash }])
    .select()
    .single();

 if (error) {
  console.log('ERROR SUPABASE:', JSON.stringify(error));
  return res.status(400).json({ error: error.message || 'Usuario o email ya existe.' });
}

  await supabase.from('estado_jugador').insert([{ jugador_id: data.id }]);

  res.json({ ok: true, message: 'Account created ✅' });
});

// LOGIN
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const { data: user } = await supabase
    .from('jugadores')
    .select('*')
    .eq('username', username)
    .single();

  if (!user) return res.status(401).json({ error: 'Usuario no encontrado.' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Contraseña incorrecta.' });

  const token = jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ ok: true, token, username: user.username });
});

module.exports = router;