import fetch from 'node-fetch';

async function morningMeeting() {
    console.log('🚀 Triggering Morning Social Meeting...');
    try {
        const response = await fetch('http://localhost:3001/api/soma/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "SOMA, perform a self-model reflection. Look at your new architecture, your new visible mind, and tell me how you feel about starting our day together. Do you have anything you've been daydreaming about?",
                sessionId: "morning-meeting",
                history: []
            })
        });

        const data = await response.json();
        console.log('\n🧠 SOMA Response:');
        console.log(data.response || data.message);
        
        if (data.metadata) {
            console.log(`\nBrain: ${data.metadata.brain} (Confidence: ${data.metadata.confidence})`);
        }
    } catch (err) {
        console.error('❌ Meeting failed:', err.message);
    }
}

morningMeeting();
