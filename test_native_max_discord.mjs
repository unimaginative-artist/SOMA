import fetch from 'node-fetch';

(async () => {
    const apiKey = "max_a1c4f354218ccb85d8ce62a2e6233a1adb0422930fb58ecb";
    try {
        console.log('Sending monitor request to MAX for soma-chat...');
        const res2 = await fetch('http://127.0.0.1:3100/api/tools/discord/monitor', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ channelName: "soma-chat", enable: true })
        });
        const monitorResult = await res2.json();
        console.log('Monitor Result:', monitorResult);
        
    } catch (e) {
        console.error(e);
    }
})();
