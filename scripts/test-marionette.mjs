import fetch from 'node-fetch';

async function testMarionette() {
    try {
        console.log('Testing Marionette Supervisor on port 9000...');
        const res = await fetch('http://127.0.0.1:9000/status');
        const data = await res.json();
        console.log('? Marionette is responding!');
        console.log(data);
    } catch (e) {
        console.error('? Marionette is not running or unreachable:', e.message);
    }
}

testMarionette();
