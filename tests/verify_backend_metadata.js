// using global fetch

async function verifyBackendMetadata() {
    const PORT = process.env.PORT || 3001;
    const url = `http://localhost:${PORT}/api/chat`;

    console.log(`Testing ${url}...`);

    const payload = {
        message: "check system health",
        context: { quickResponse: false }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        console.log('Response received:');
        console.log(JSON.stringify(data, null, 2));

        let success = true;

        // Check toolsUsed
        if (Array.isArray(data.toolsUsed)) {
            console.log('✅ toolsUsed field is present and is an array.');
            if (data.toolsUsed.length > 0) {
                console.log(`✅ toolsUsed array contains ${data.toolsUsed.length} items. (Tool trigger successful)`);
            } else {
                console.warn('⚠️ toolsUsed is empty. (Tool might not have triggered, but field exists)');
            }
        } else {
            console.error('❌ toolsUsed field is MISSING or not an array.');
            success = false;
        }

        // Check routing
        if (data.routing) {
            console.log('✅ routing field is present.');
        } else {
            console.error('❌ routing field is MISSING.');
            success = false;
        }

        // Check uncertainty
        if (data.uncertainty) {
            console.log('✅ uncertainty field is present.');
        } else {
            console.error('❌ uncertainty field is MISSING.');
            success = false;
        }

        if (success) {
            console.log('\n✅ VERIFICATION PASSED: Backend is exposing metadata.');
        } else {
            console.error('\n❌ VERIFICATION FAILED: Missing metadata fields.');
            process.exit(1);
        }

    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.error(`❌ Connection refused at ${url}. Is the SOMA server running?`);
            console.log('Please ensure "npm run server" is running in another terminal.');
        } else {
            console.error('❌ Error testing backend:', error.message);
        }
        process.exit(1);
    }
}

// Check if node-fetch is available, if not, use native fetch (Node 18+)
if (typeof fetch === 'undefined') {
    // Try to use global fetch if available
}

verifyBackendMetadata();
