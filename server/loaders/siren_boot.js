import { VocalSynthesisArbiter } from '../../arbiters/VocalSynthesisArbiter.js';
export async function bootSiren(system, app) {
    console.log('ðŸ§œâ€â™€ï¸ [Siren] Standalone Booter Active...');
    const synthesis = new VocalSynthesisArbiter('SirenStandalone', { primaryEngine: 'fish-speech' });
    await synthesis.initialize();
    system.vocalSynthesis = synthesis;
    app.post('/api/siren/synthesize', async (req, res) => {
        try {
            const { text, emotion, requestId } = req.body;
            const result = await synthesis.handleSynthesis({ text, emotion, requestId });
            res.json({ success: result.success, mode: 'standalone', error: result.error });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
    console.log('ðŸ§œâ€â™€ï¸ [Siren] Standalone Route: /api/siren/synthesize');
}
