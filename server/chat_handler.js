// Simple Chat Endpoint (Restored)
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!quadBrain) {
            return res.status(503).json({ error: 'SOMA Brain is initializing, please wait...' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Message field required' });
        }

        // Using LOGOS by default for chat
        const result = await quadBrain.reason({
            query: message,
            mode: 'fast', // Fast chat mode
            brain: 'LOGOS'
        });

        res.json({
            success: true,
            response: result.response,
            metadata: {
                confidence: result.confidence,
                brain: result.brainUsed
            }
        });

    } catch (error) {
        console.error('Chat API Error:', error);
        res.status(500).json({
            error: 'Brain Malfunction',
            details: error.message
        });
    }
});
