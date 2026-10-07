import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VisualObjectMemory } from '../core/VisualObjectMemory.js';
import { SocialIdentityService } from '../core/SocialIdentityService.js';

async function fixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-social-'));
    const objectMemory = new VisualObjectMemory({ dbPath: path.join(dir, 'objects.db') }).initialize();
    return { dir, objectMemory, service: new SocialIdentityService({ objectMemory }) };
}

test('explicit introduction enrolls exactly one recently visible person', async () => {
    const { dir, objectMemory, service } = await fixture();
    const [person] = objectMemory.ingest({ timestamp: 1000, objects: [{ label: 'person', bbox: [0.2, 0.1, 0.3, 0.6] }] });
    const result = await service.processIntroduction('Hello, my name is Jamie.', { timestamp: 1200 });
    assert.equal(result.enrolled, true);
    assert.equal(objectMemory.getProfileForTrack(person.trackId).display_name, 'Jamie');
    objectMemory.close(); await fs.rm(dir, { recursive: true, force: true });
});

test('introduction refuses ambiguous visual binding when two people are visible', async () => {
    const { dir, objectMemory, service } = await fixture();
    objectMemory.ingest({ timestamp: 1000, objects: [
        { label: 'person', bbox: [0.05, 0.1, 0.25, 0.6] }, { label: 'person', bbox: [0.65, 0.1, 0.25, 0.6] }
    ] });
    const result = await service.processIntroduction("Hi, I'm Sam.", { timestamp: 1200 });
    assert.equal(result.enrolled, false);
    assert.equal(result.reason, 'ambiguous_multiple_people');
    objectMemory.close(); await fs.rm(dir, { recursive: true, force: true });
});

test('ordinary speech cannot create an identity', async () => {
    const { dir, objectMemory, service } = await fixture();
    objectMemory.ingest({ timestamp: 1000, objects: [{ label: 'person', bbox: [0.2, 0.1, 0.3, 0.6] }] });
    const result = await service.processIntroduction('Jamie is coming over later.', { timestamp: 1200 });
    assert.equal(result.handled, false);
    objectMemory.close(); await fs.rm(dir, { recursive: true, force: true });
});
