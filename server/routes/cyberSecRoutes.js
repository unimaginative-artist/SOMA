import express from 'express';
import { CyberSecArbiter } from '../../arbiters/CyberSecArbiter.js';

const router = express.Router();
const arbiter = new CyberSecArbiter();

// View current challenge
router.get('/challenge', async (req, res) => {
    try {
        let challenge = arbiter.currentChallenge;
        if (!challenge) {
            challenge = await arbiter.generateChallenge();
        }
        res.json({ success: true, challenge });
    } catch (error) {
        console.error('Error fetching cybersec challenge:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate a new challenge
router.post('/challenge/generate', async (req, res) => {
    try {
        const challenge = await arbiter.generateChallenge();
        res.json({ success: true, challenge });
    } catch (error) {
        console.error('Error generating cybersec challenge:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Submit answer for current challenge
router.post('/challenge/submit', async (req, res) => {
    try {
        const { challengeId, answer } = req.body;
        if (!challengeId || !answer) {
            return res.status(400).json({ success: false, error: 'Missing challengeId or answer in request body' });
        }
        
        const result = await arbiter.submitAnswer(challengeId, answer);
        res.json({ success: true, result });
    } catch (error) {
        console.error('Error submitting cybersec answer:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
