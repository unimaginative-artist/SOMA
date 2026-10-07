let audioCtx = null;

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

export const playMessage = () => {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.15);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.18);
    } catch (err) {
        console.warn('AxisAudio: playMessage failed', err);
    }
};

export const playMention = () => {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
            const time = now + i * 0.07;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time);
            
            gain.gain.setValueAtTime(0.08, time);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(time);
            osc.stop(time + 0.36);
        });
    } catch (err) {
        console.warn('AxisAudio: playMention failed', err);
    }
};

export const playSoma = () => {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        // Play a warm detuned major chord (A3, C#4, E4, A4)
        const freqs = [220.00, 277.18, 329.63, 440.00];
        freqs.forEach((freq, idx) => {
            [0, 1.5].forEach((detune) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq + detune, now);
                
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.03, now + 0.4);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(now);
                osc.stop(now + 1.8);
            });
        });
    } catch (err) {
        console.warn('AxisAudio: playSoma failed', err);
    }
};

export const playUI = () => {
    try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.04);

        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.05);
    } catch (err) {
        console.warn('AxisAudio: playUI failed', err);
    }
};
