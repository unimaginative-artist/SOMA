import express from 'express';
import axisStore from '../axis/AxisStore.js';
import messageBroker from '../../core/MessageBroker.js';

const ZONES = [
    { id: 'food-court',   name: 'Food Court'   },
    { id: 'art-district', name: 'Art District' },
    { id: 'arcade',       name: 'The Arcade'   },
    { id: 'soma-cafe',    name: 'Soma Café'    },
    { id: 'work-lounge',  name: 'Work Lounge'  },
    { id: 'music-venue',  name: 'Music Venue'  },
    { id: 'tech-lab',     name: 'Tech Lab'     },
];

const WS_NAME = 'Third Place';
const WS_ICON = '✦';

export default function createThirdPlaceRoutes(system) {
    const router = express.Router();

    // Relay positions arriving from GMN peers out to local WebSocket clients
    try {
        messageBroker.subscribe('gmn.relay.thirdplace.position', (data) => {
            const payload = data?.payload ?? data;
            bcast('thirdplace.position', payload);
        });
    } catch {}

    const bcast = (type, data) => {
        try {
            system?.wss?.clients?.forEach(c => {
                if (c.readyState === 1) c.send(JSON.stringify({ type, ...data }));
            });
        } catch {}
    };

    const getUser = (req) => ({
        userId:    req.headers['x-axis-user-id']    || 'anon',
        userName:  req.headers['x-axis-user-name']  || 'Anonymous',
        userColor: req.headers['x-axis-user-color'] || 'blue',
    });

    // ── GET /api/thirdplace/channels ─────────────────────────────────────────
    // Returns { zoneId: channelId } map, auto-creating workspace + channels on first call.
    router.get('/channels', (req, res) => {
        try {
            let ws = axisStore.getWorkspaces().find(w => w.name === WS_NAME);
            if (!ws) {
                ws = axisStore.createWorkspace({
                    name:      WS_NAME,
                    icon:      WS_ICON,
                    color:     'violet',
                    type:      'thirdplace',
                    createdBy: 'system',
                });
            }

            const existing   = axisStore.getChannels(ws.id);
            const channelMap = {};

            for (const zone of ZONES) {
                // createWorkspace auto-creates a 'general' channel — skip collision
                let ch = existing.find(c => c.name === zone.id);
                if (!ch) {
                    ch = axisStore.createChannel({
                        workspaceId: ws.id,
                        name:        zone.id,
                        type:        'text',
                        description: zone.name,
                        createdBy:   'system',
                    });
                }
                channelMap[zone.id] = ch.id;
            }

            res.json({ ok: true, workspaceId: ws.id, channels: channelMap });
        } catch (e) {
            console.error('[ThirdPlace] /channels error:', e.message);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── POST /api/thirdplace/position ────────────────────────────────────────
    // Broadcasts position to local WebSocket clients AND all GMN peers.
    router.post('/position', (req, res) => {
        try {
            const u = getUser(req);
            const { x, y, zoneId } = req.body || {};
            const posData = {
                userId:    u.userId,
                userName:  u.userName,
                userColor: u.userColor,
                x,
                y,
                zoneId,
                ts: Date.now(),
            };
            // Local broadcast
            bcast('thirdplace.position', posData);
            // Cross-node broadcast via GMN
            system?.gmnConnectivity?.sendToNetwork('thirdplace.position', posData);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    return router;
}
