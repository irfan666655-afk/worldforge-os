const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const { validateEnv } = require('./env-validation.js');
const bridge = require('./wf-payment-bridge.v1.js');
const WFKernel = require('../worldforge-kernel.v1.1.js');
const P2Ext = require('./wfkernel-p2-ext.v1.2.js');
const Chain = require('./wf-event-chain.v1.js');

/* Boot preflight: unpopulated seams are DISABLED (503 + ENV code), never
 * run on undefined credentials. The server still boots for what it can do. */
const env = validateEnv(process.env);
if (!env.ok) {
    for (const m of env.missing)
        console.error(`[wf-env] ${m.code} ${m.key} unset — seam '${m.seam}' DISABLED (fail-closed). Fix: ${m.fix}`);
}

const app = express();
app.use(cors());

/* ---- payment webhook seam (MON-1 bridge) ----
 * Registered BEFORE express.json(): HMAC verification needs the exact raw
 * bytes the processor signed, not a re-serialized parse. */
const PAY_STATUS = { 'PAY-01': 503, 'PAY-02': 401, 'PAY-03': 401, 'PAY-04': 401, 'PAY-05': 400, 'PAY-06': 400, 'PAY-07': 409, 'PAY-08': 500 };

app.post('/api/webhooks/payment', express.raw({ type: '*/*' }), async (req, res) => {
    if (!env.seams['payment-webhook'])
        return res.status(503).json({ code: 'ENV-03', error: "payment-webhook seam disabled — WF_WEBHOOK_SECRET unset (fail-closed)" });
    try {
        const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
        bridge.verifySignature({ rawBody, header: req.get('wf-signature') || '', secret: process.env.WF_WEBHOOK_SECRET });
        let payload;
        try { payload = JSON.parse(rawBody); }
        catch { return res.status(400).json({ code: 'PAY-05', error: 'authenticated body is not valid JSON' }); }
        const normalized = bridge.normalizeProcessorEvent(payload);
        const kernel = await governance();
        const out = await bridge.ingest(kernel, normalized);
        res.json({ received: true, tx_hash: out.tx_hash, chain_head: out.chain_head });
    } catch (e) {
        const code = e.code || 'PAY-08';
        console.error(`[wf-webhook] refused ${code}: ${e.message}`);
        res.status(PAY_STATUS[code] || 400).json({ code, error: e.message });
    }
});

app.use(express.json());

/* ---- governance kernel (file-backed, survives restarts) ----
 * The same kernel + ext + G2 chain the artifact runs, on a JSON-file
 * storage seam. Verified payments land in decision_log hash-chained. */
const GOV_FILE = process.env.WF_GOV_FILE || path.join(__dirname, '..', 'work', 'server-governance.json');

function fileStorage(file) {
    let mem = {};
    try { mem = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first boot */ }
    const flush = () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(mem));
    };
    return {
        get: async (k) => (k in mem ? { key: k, value: mem[k] } : null),
        set: async (k, v) => { mem[k] = v; flush(); return { key: k, value: v }; },
        delete: async (k) => { delete mem[k]; flush(); return { key: k, deleted: true }; },
        list: async (p) => ({ keys: Object.keys(mem).filter((k) => k.startsWith(p || '')) })
    };
}

let govPromise = null;
function governance() {
    if (!govPromise) govPromise = (async () => {
        const storage = fileStorage(GOV_FILE);
        const pipelineCanon = {
            stages: [{ id: 'st0', label: 'Open' }, { id: 'st1', label: 'Closed' }],
            storage: { projectPrefix: 'wfproj:' },
            budget: { currency: 'USD' }
        };
        const kernel = WFKernel.createKernel({
            storage,
            pipeline: { stages: ['Open', 'Closed'], gates: {}, storage: pipelineCanon.storage },
            actor: 'server'
        });
        P2Ext.install(kernel, {
            pipeline: pipelineCanon,
            roster: { agents: [{ id: 'payment-gateway', name: 'Payment Gateway' }] },
            storage
        });
        const existing = await kernel.loadProjects();
        let proj = existing.find((p) => p.name === 'server-governance');
        if (!proj) proj = await kernel.createProject({ name: 'server-governance', type: 'ledger' });
        kernel.bindProject(proj.id);
        Chain.install(kernel);
        return kernel;
    })();
    return govPromise;
}

/* Read-only provenance view: chained payment records + chain verification.
 * Serialized for the visual tier's ingestServerEvents seam. */
app.get('/api/payments', async (req, res) => {
    try {
        const kernel = await governance();
        const log = kernel.getProjectState().decision_log || [];
        res.json({
            chain: kernel.verifyEventChain(),
            payments: log.filter((r) => r.kind === 'payment-verified').map((r) => ({
                event_id: r.payment.event_id, type: r.payment.type,
                cost: r.payment.cost, currency: r.payment.currency,
                tx_hash: r.payment.tx_hash, ts: r.ts
            }))
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* ---- supabase-backed roster seam (guarded, fail-closed) ---- */
const supabase = env.seams['roster-api']
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;
const rosterDisabled = (res) =>
    res.status(503).json({ code: 'ENV-01', error: 'roster-api seam disabled — SUPABASE_URL / SUPABASE_ANON_KEY unset (fail-closed)' });

const PORT = process.env.PORT || 5000;

// Serve our single-file interactive v6.0 client at the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../worldforge_v6_0.html'));
});

// Get full active roster data
app.get('/api/roster', async (req, res) => {
    if (!supabase) return rosterDisabled(res);
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
    if (!supabase) return rosterDisabled(res);
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
    if (!supabase) return rosterDisabled(res);
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
