const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');
const authMiddleware = require('../middleware/auth');

// GET MY ALLIANCE
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const { data: membership } = await supabase
      .from('alliance_members').select('alliance_id, role')
      .eq('jugador_id', req.jugador.id).maybeSingle();
    if (!membership) return res.json({ ok: true, alliance: null });

    const { data: alliance } = await supabase
      .from('alliances').select('*').eq('id', membership.alliance_id).maybeSingle();
    if (!alliance) return res.json({ ok: true, alliance: null });

    const { data: members } = await supabase
      .from('alliance_members').select('jugador_id, role, joined_at')
      .eq('alliance_id', alliance.id);

    const memberDetails = [];
    for (const m of (members || [])) {
      const { data: j } = await supabase.from('jugadores').select('username').eq('id', m.jugador_id).maybeSingle();
      const { data: e } = await supabase.from('estado_jugador').select('save_data').eq('jugador_id', m.jugador_id).maybeSingle();
      memberDetails.push({
        jugador_id: m.jugador_id, username: j?.username || 'Unknown', role: m.role,
        power: e?.save_data?.playerResources?.power || 0, joined_at: m.joined_at
      });
    }
    memberDetails.sort((a, b) => a.role === 'leader' ? -1 : b.role === 'leader' ? 1 : b.power - a.power);
    const totalPower = memberDetails.reduce((s, m) => s + m.power, 0);

    res.json({ ok: true, alliance: {
      id: alliance.id, name: alliance.name, tag: alliance.tag, leader_id: alliance.leader_id,
      created_at: alliance.created_at, members: memberDetails, totalPower, myRole: membership.role
    }});
  } catch (err) { console.error('ALLIANCE MINE:', err); res.status(500).json({ ok: false, error: 'Server error' }); }
});

// LIST ALL ALLIANCES
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const { data: alliances } = await supabase.from('alliances').select('*').order('created_at', { ascending: true });
    const result = [];
    for (const a of (alliances || [])) {
      const { data: members } = await supabase.from('alliance_members').select('jugador_id').eq('alliance_id', a.id);
      const { data: leader } = await supabase.from('jugadores').select('username').eq('id', a.leader_id).maybeSingle();
      let totalPower = 0;
      for (const m of (members || [])) {
        const { data: e } = await supabase.from('estado_jugador').select('save_data').eq('jugador_id', m.jugador_id).maybeSingle();
        totalPower += e?.save_data?.playerResources?.power || 0;
      }
      result.push({ id: a.id, name: a.name, tag: a.tag, leader: leader?.username || 'Unknown', memberCount: (members||[]).length, totalPower });
    }
    result.sort((a, b) => b.totalPower - a.totalPower);
    res.json({ ok: true, alliances: result });
  } catch (err) { console.error('ALLIANCE LIST:', err); res.status(500).json({ ok: false, error: 'Server error' }); }
});

// CREATE ALLIANCE
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { name, tag, description } = req.body;
    if (!name || name.length < 2 || name.length > 20) return res.json({ ok: false, error: 'Name must be 2-20 characters.' });
    if (!tag || tag.length < 2 || tag.length > 5) return res.json({ ok: false, error: 'Tag must be 2-5 characters.' });
    const { data: existing } = await supabase.from('alliance_members').select('id').eq('jugador_id', req.jugador.id).maybeSingle();
    if (existing) return res.json({ ok: false, error: 'You are already in an alliance.' });

    // Get username from save
    const { data: saveRow } = await supabase.from('estado_jugador').select('save_data').eq('jugador_id', req.jugador.id).maybeSingle();
    const username = saveRow?.save_data?._username || 'Unknown';

    const { data: alliance, error } = await supabase.from('alliances')
      .insert([{ name, tag: tag.toUpperCase(), leader_id: req.jugador.id, description: (description || '').substring(0, 200) }]).select().maybeSingle();
    if (error) return res.json({ ok: false, error: error.message?.includes('unique') ? 'Name or tag already taken.' : error.message });

    // Auto-join creator as owner
    await supabase.from('alliance_members').insert([{
      alliance_id: alliance.id,
      jugador_id: req.jugador.id,
      username: username,
      role: 'leader'
    }]);
    res.json({ ok: true, alliance });
  } catch (err) { console.error('ALLIANCE CREATE:', err); res.status(500).json({ ok: false, error: 'Server error' }); }
});

// JOIN ALLIANCE
router.post('/join', authMiddleware, async (req, res) => {
  try {
    const allianceId = req.body.allianceId || req.body.alliance_id;
    if (!allianceId) return res.json({ ok: false, error: 'Missing alliance ID' });

    const { data: existing } = await supabase.from('alliance_members').select('id').eq('jugador_id', req.jugador.id).maybeSingle();
    if (existing) return res.json({ ok: false, error: 'You are already in an alliance.' });

    const { data: alliance } = await supabase.from('alliances').select('id').eq('id', allianceId).maybeSingle();
    if (!alliance) return res.json({ ok: false, error: 'Alliance not found.' });

    // Get username from save
    const { data: saveRow } = await supabase.from('estado_jugador').select('save_data').eq('jugador_id', req.jugador.id).maybeSingle();
    const username = saveRow?.save_data?._username || 'Unknown';

    const { error } = await supabase.from('alliance_members').insert([{
      alliance_id: allianceId,
      jugador_id: req.jugador.id,
      username: username,
      role: 'member'
    }]);
    if (error) return res.json({ ok: false, error: error.message });
    res.json({ ok: true });
  } catch (err) { console.error('ALLIANCE JOIN:', err); res.status(500).json({ ok: false, error: 'Server error' }); }
});

// LEAVE ALLIANCE
router.post('/leave', authMiddleware, async (req, res) => {
  try {
    const { data: mem } = await supabase.from('alliance_members').select('alliance_id, role').eq('jugador_id', req.jugador.id).maybeSingle();
    if (!mem) return res.json({ ok: false, error: 'Not in an alliance.' });
    if (mem.role === 'leader') {
      const { data: others } = await supabase.from('alliance_members').select('jugador_id')
        .eq('alliance_id', mem.alliance_id).neq('jugador_id', req.jugador.id).order('joined_at').limit(1);
      if (others && others.length > 0) {
        await supabase.from('alliance_members').update({ role: 'leader' }).eq('jugador_id', others[0].jugador_id);
        await supabase.from('alliances').update({ leader_id: others[0].jugador_id }).eq('id', mem.alliance_id);
      } else {
        await supabase.from('alliances').delete().eq('id', mem.alliance_id);
      }
    }
    await supabase.from('alliance_members').delete().eq('jugador_id', req.jugador.id);
    res.json({ ok: true });
  } catch (err) { console.error('ALLIANCE LEAVE:', err); res.status(500).json({ ok: false, error: 'Server error' }); }
});

// KICK MEMBER (leader only)
router.post('/kick', authMiddleware, async (req, res) => {
  try {
    const { jugador_id } = req.body;
    const { data: my } = await supabase.from('alliance_members').select('alliance_id, role').eq('jugador_id', req.jugador.id).maybeSingle();
    if (!my || my.role !== 'leader') return res.json({ ok: false, error: 'Only the leader can kick.' });
    if (jugador_id === req.jugador.id) return res.json({ ok: false, error: 'Cannot kick yourself.' });
    await supabase.from('alliance_members').delete().eq('jugador_id', jugador_id).eq('alliance_id', my.alliance_id);
    res.json({ ok: true });
  } catch (err) { console.error('ALLIANCE KICK:', err); res.status(500).json({ ok: false, error: 'Server error' }); }
});

module.exports = router;