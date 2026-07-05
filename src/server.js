const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const PORT = process.env.PORT || 5000;

// Get full active roster data
app.get('/api/roster', async (req, res) => {
    try {
        const { data: guilds, error: gError } = await supabase.from('guilds').select('*');
        if (gError) throw gError;

        const { data: agents, error: aError } = await supabase.from('agents').select('*');
        if (aError) throw aError;

        // Structure into unified WorldForge JSON format
        const structured = guilds.map(g => ({
            key: g.key,
            name: g.name,
            agents: agents.filter(a => a.guild_id === g.id).map(a => ({
                name: a.name,
                resp: a.responsibility,
                auth: a.authority,
                escalatesTo: a.escalation_targets,
                mem: a.memory_touchpoints
            }))
        }));

        res.json({ rosterVersion: "5.2.0", guilds: structured });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update agent schema
app.post('/api/agents', async (req, res) => {
    const { guild_key, name, resp, auth, escalatesTo, mem } = req.body;
    try {
        const { data: guild, error: gErr } = await supabase.from('guilds').select('id').eq('key', guild_key).single();
        if (gErr) throw gErr;

        const { data, error } = await supabase.from('agents').insert([{
            guild_id: guild.id,
            name,
            responsibility: resp,
            authority: auth,
            escalation_targets: escalatesTo,
            memory_touchpoints: mem
        }]);
        if (error) throw error;

        res.status(201).json({ success: true, data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`WorldForge Service Engine active on port ${PORT}`);
});

module.exports = app;
