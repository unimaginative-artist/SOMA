const express = require('express');
const router = express.Router();
const workLedger = require('../../core/AutonomousWorkLedger.cjs');

module.exports = (system) => {
    
    // Inject a new goal from MAX into SOMA's ledger
    router.post('/inject-goal', async (req, res) => {
        try {
            const { title, description, priority, category } = req.body;
            if (!title) return res.status(400).json({ error: 'Title required' });
            
            const goalId = await workLedger.createGoal({
                title,
                description: description || 'Injected via MAX Control Channel',
                priority: priority || 50,
                category: category || 'engineering',
                ownerLobe: 'logos'
            });
            
            res.json({ success: true, goalId, message: 'Goal successfully injected into SOMA ledger' });
        } catch (error) {
            console.error('[MaxControl] inject-goal error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Update SOMA's state or trigger compaction
    router.post('/update-state', async (req, res) => {
        try {
            const { action, payload } = req.body;
            
            if (action === 'trigger_compaction' && system.mnemonicArbiter) {
                // Force mnemonic compaction check
                if (typeof system.mnemonicArbiter.compact === 'function') {
                    await system.mnemonicArbiter.compact();
                } else if (typeof system.mnemonicArbiter.startCompactionDaemon === 'function') {
                    // Try to trigger the daemon
                    system.mnemonicArbiter.startCompactionDaemon();
                }
                return res.json({ success: true, message: 'Memory compaction triggered' });
            }
            
            if (action === 'restart') {
                // SOMA reboot (use with extreme caution)
                setTimeout(() => {
                    console.log('[MaxControl] Rebooting SOMA via MAX request...');
                    process.exit(0);
                }, 1000);
                return res.json({ success: true, message: 'Restarting SOMA' });
            }

            res.status(400).json({ error: 'Unknown action' });
        } catch (error) {
            console.error('[MaxControl] update-state error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
};
