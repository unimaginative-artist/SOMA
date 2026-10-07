import test from 'node:test';
import assert from 'node:assert/strict';
import { RotarySensorHead } from '../core/RotarySensorHead.js';

const sensor = (id, modality) => ({ id, modality, read: async ({ triggeredAt }) => ({ sample: id, timestamp: triggeredAt }) });

test('a mirror station activates at most two synchronized sensors', async () => {
    const head = new RotarySensorHead();
    head.registerStation({ id: 'front-depth', angleDeg: 0, sensors: [sensor('rgb', 'visible'), sensor('depth', 'depth')] });
    const view = await head.select('front-depth');
    assert.equal(view.readings.length, 2);
    assert.equal(view.synchronized, true);
    assert.equal(view.alignmentErrorDeg, 0);
    assert.throws(() => head.registerStation({ id: 'bad', angleDeg: 90, sensors: [sensor('a'), sensor('b'), sensor('c')] }));
});

test('scan indexes every station and preserves angular provenance', async () => {
    const head = new RotarySensorHead({ maxRpm: 300 });
    head.registerStation({ id: 'visible', angleDeg: 0, sensors: [sensor('rgb', 'visible')] });
    head.registerStation({ id: 'thermal-depth', angleDeg: 120, sensors: [sensor('thermal', 'thermal'), sensor('tof', 'depth')] });
    head.registerStation({ id: 'uv', angleDeg: 240, sensors: [sensor('uv', 'ultraviolet')] });
    const scan = await head.scan({ rpm: 900 });
    assert.equal(scan.frames.length, 3);
    assert.equal(scan.effectiveRpm, 300);
    assert.deepEqual(scan.frames.map(frame => frame.mirrorAngleDeg), [0, 120, 240]);
    assert.equal(scan.complete, true);
    assert.deepEqual(scan.modalities.sort(), ['depth', 'thermal', 'ultraviolet', 'visible']);
});

test('faults stop scans until an operator clears them', async () => {
    const head = new RotarySensorHead();
    head.registerStation({ id: 'visible', angleDeg: 0, sensors: [sensor('rgb', 'visible')] });
    head.setFault('encoder disagreement');
    await assert.rejects(() => head.scan(), /encoder disagreement/);
    assert.equal(head.clearFault().cleared, false);
    assert.equal(head.clearFault({ operatorConfirmed: true }).cleared, true);
    assert.equal((await head.scan()).complete, true);
});
