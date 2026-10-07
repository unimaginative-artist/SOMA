import express from 'express';
import notificationService from '../services/NotificationService.js';

const router = express.Router();

router.get('/settings', (req, res) => {
    res.json({ success: true, settings: notificationService.getSettings() });
});

router.get('/digest/status', (_req, res) => {
    res.json({
        success: true,
        summary: notificationService.digest.summary(),
        pending: notificationService.digest.peek()
    });
});

router.post('/settings', (req, res) => {
    const { discordWebhookUrl } = req.body;
    const success = notificationService.saveSettings({ discordWebhookUrl });
    res.json({ success });
});

// End-to-end delivery test: webhook if configured, else SOMA's Discord bot DM.
router.post('/test', async (req, res) => {
    try {
        const delivery = await notificationService.sendAlert(
            req.body?.title || '🧪 Notification Test',
            req.body?.message || 'If you can read this on Discord, the trading notification pipe works.'
        );
        res.status(delivery?.sent ? 200 : 503).json({ success: Boolean(delivery?.sent), delivery });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Fire the daily gate summary on demand (same one scheduled for 9:00 AM).
router.post('/test-daily-summary', async (_req, res) => {
    try {
        const delivery = await notificationService.sendDailyGateSummary();
        res.status(delivery?.sent ? 200 : 503).json({ success: Boolean(delivery?.sent), delivery });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
