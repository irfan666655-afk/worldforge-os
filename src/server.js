const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const PORT = process.env.PORT || 5000;

// Serve our single-file interactive v6.0 client at the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../worldforge_v6_0.html'));
});

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
                escalatesTo: a.escalation_targets || [],
                mem: a.memory_touchpoints
            }))
        }));

        res.json({ rosterVersion: "5.2.0", guilds: structured });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Overwrite and sync full roster configuration
app.post('/api/roster', async (req, res) => {
    const { guilds } = req.body;
    try {
        for (const g of guilds) {
            // Find or create target guild
            let { data: guild, error: gErr } = await supabase
                .from('guilds')
                .select('id')
                .eq('key', g.key)
                .maybeSingle();

            if (gErr) throw gErr;

            let guildId;
            if (!guild) {
                const { data: newGuild, error: insErr } = await supabase
                    .from('guilds')
                    .insert([{ key: g.key, name: g.name, description: 'Auto-configured runtime guild' }])
                    .select('id')
                    .single();
                if (insErr) throw insErr;
                guildId = newGuild.id;
            } else {
                guildId = guild.id;
            }

            // Clear old agents to prevent duplicates on overwrite
            const { error: delErr } = await supabase
                .from('agents')
                .delete()
                .eq('guild_id', guildId);
            if (delErr) throw delErr;

            // Bulk insert new agents if any exist
            if (g.agents && g.agents.length > 0) {
                const inserts = g.agents.map(a => ({
                    guild_id: guildId,
                    name: a.name,
                    responsibility: a.resp,
                    authority: a.auth,
                    escalation_targets: a.escalatesTo || [],
                    memory_touchpoints: a.mem
                }));

                const { error: insAgentsErr } = await supabase
                    .from('agents')
                    .insert(inserts);
                if (insAgentsErr) throw insAgentsErr;
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Individual Agent Insertion Endpoint
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
            escalation_targets: escalatesTo || [],
            memory_touchpoints: mem
        }]);
        if (error) throw error;

        res.status(201).json({ success: true, data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// For Vercel Serverless compatibility, we export the app
module.exports = app;

// Listen if started directly
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`WorldForge Service Engine active on port ${PORT}`);
    });
}
