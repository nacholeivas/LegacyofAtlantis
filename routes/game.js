const express = require('express');
const router = express.Router();
const supabase = require('../middleware/supabase');
const authMiddleware = require('../middleware/auth');

// ============================================================
// SAVE
// ============================================================
router.post('/save', authMiddleware, async (req, res) => {
  const { saveData } = req.body;
  const { error } = await supabase
    .from('estado_jugador')
    .upsert({ jugador_id: req.jugador.id, save_data: saveData }, { onConflict: 'jugador_id' });

  if (error) { console.log('ERROR SAVE:', error); return res.status(500).json({ error: 'No se pudo guardar.' }); }
  res.json({ ok: true });
});

// ============================================================
// LOAD
// ============================================================
router.get('/load', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('estado_jugador')
    .select('save_data')
    .eq('jugador_id', req.jugador.id)
    .single();

  if (error) { console.log('ERROR LOAD:', error); return res.status(500).json({ error: 'No se pudo cargar.' }); }
  res.json({ ok: true, saveData: data?.save_data || null });
});

// ============================================================
// GET ALL PLAYER CITIES (for map)
// ============================================================
router.get('/cities', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('estado_jugador')
      .select('jugador_id, save_data');

    if (error) {
      console.log('ERROR CITIES:', error);
      return res.status(500).json({ ok: false, error: 'No se pudieron cargar.' });
    }

    const cities = [];
    for (const row of (data || [])) {
      const sd = row.save_data;
      if (sd?.playerCity?.coordX != null) {
        cities.push({
          username: sd._username || 'Player_' + String(row.jugador_id).substring(0, 6),
          coordX: sd.playerCity.coordX,
          coordY: sd.playerCity.coordY,
          fortressLevel: sd.builtSlots?.['1']?.level || 1
        });
      }
    }

    res.json({ ok: true, cities });
  } catch (err) {
    console.error('ERROR CITIES:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ============================================================
// LEADERBOARD (sorted by power)
// ============================================================
router.get('/leaderboard', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('estado_jugador')
      .select('jugador_id, save_data');

    if (error) {
      console.log('ERROR LEADERBOARD:', error);
      return res.status(500).json({ ok: false, error: 'No se pudo cargar.' });
    }

    // Get all alliance memberships
    let allianceMap = {};
    try {
      const { data: members } = await supabase
        .from('alliance_members')
        .select('jugador_id, alliance_id, alliances(name, tag)');
      if (members) {
        for (const m of members) {
          allianceMap[m.jugador_id] = m.alliances?.name || '-';
        }
      }
    } catch(e) { /* alliance tables may not exist yet */ }

    const players = [];
    for (const row of (data || [])) {
      const sd = row.save_data;
      if (!sd) continue;
      players.push({
        username: sd._username || 'Player_' + String(row.jugador_id).substring(0, 6),
        power: sd.playerResources?.power || 0,
        fortressLevel: sd.builtSlots?.['1']?.level || 1,
        coordX: sd.playerCity?.coordX ?? 0,
        coordY: sd.playerCity?.coordY ?? 0,
        alliance: allianceMap[row.jugador_id] || '-'
      });
    }

    players.sort((a, b) => b.power - a.power);
    res.json({ ok: true, players });
  } catch (err) {
    console.error('ERROR LEADERBOARD:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ============================================================
// PVP: GET DEFENDER DATA
// ============================================================
router.get('/defender/:username', authMiddleware, async (req, res) => {
  try {
    const targetUser = req.params.username;
    
    // Find all saves, match by _username
    const { data, error } = await supabase
      .from('estado_jugador')
      .select('jugador_id, save_data');

    if (error) return res.status(500).json({ ok: false, error: 'Server error' });

    const defender = (data || []).find(row => 
      row.save_data?._username?.toLowerCase() === targetUser.toLowerCase()
    );

    if (!defender) return res.json({ ok: false, error: 'Player not found' });

    const sd = defender.save_data;
    res.json({
      ok: true,
      defender: {
        username: sd._username,
        jugadorId: defender.jugador_id,
        troops: sd.troopQuantities || {},
        power: sd.playerResources?.power || 0,
        resources: {
          wood: sd.playerResources?.wood || 0,
          stone: sd.playerResources?.stone || 0,
          iron: sd.playerResources?.iron || 0,
          food: sd.playerResources?.food || 0,
          gold: sd.playerResources?.gold || 0
        },
        fortressLevel: sd.builtSlots?.['1']?.level || 1,
        coordX: sd.playerCity?.coordX || 0,
        coordY: sd.playerCity?.coordY || 0
      }
    });
  } catch (err) {
    console.error('ERROR DEFENDER:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// ============================================================
// PVP: APPLY RESULTS TO DEFENDER
// ============================================================
router.post('/pvp-result', authMiddleware, async (req, res) => {
  try {
    const { defenderUsername, troopLosses, resourcesLooted } = req.body;

    // Find defender's save
    const { data } = await supabase
      .from('estado_jugador')
      .select('jugador_id, save_data');

    const defRow = (data || []).find(row =>
      row.save_data?._username?.toLowerCase() === defenderUsername.toLowerCase()
    );

    if (!defRow) return res.json({ ok: false, error: 'Defender not found' });

    const sd = { ...defRow.save_data };

    // Deduct troops
    if (troopLosses && sd.troopQuantities) {
      Object.entries(troopLosses).forEach(([troopId, lost]) => {
        if (sd.troopQuantities[troopId] != null) {
          sd.troopQuantities[troopId] = Math.max(0, sd.troopQuantities[troopId] - lost);
        }
      });
    }

    // Deduct resources (attacker looted these)
    if (resourcesLooted && sd.playerResources) {
      Object.entries(resourcesLooted).forEach(([res, amt]) => {
        if (sd.playerResources[res] != null) {
          sd.playerResources[res] = Math.max(0, sd.playerResources[res] - amt);
        }
      });
    }

    // Save updated defender data
    const { error: saveErr } = await supabase
      .from('estado_jugador')
      .update({ save_data: sd })
      .eq('jugador_id', defRow.jugador_id);

    if (saveErr) return res.json({ ok: false, error: 'Could not update defender' });

    res.json({ ok: true });
  } catch (err) {
    console.error('ERROR PVP RESULT:', err);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});
module.exports = router;