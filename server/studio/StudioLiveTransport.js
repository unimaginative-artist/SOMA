import { AccessToken } from 'livekit-server-sdk';

function liveKitConfigured() {
    return Boolean(
        String(process.env.LIVEKIT_URL || '').trim() &&
        String(process.env.LIVEKIT_API_KEY || '').trim() &&
        String(process.env.LIVEKIT_API_SECRET || '').trim()
    );
}

function preferredProvider() {
    const configured = String(process.env.STUDIO_LIVE_TRANSPORT || 'auto').trim().toLowerCase();
    if (configured === 'p2p') return 'p2p';
    if (configured === 'livekit') return liveKitConfigured() ? 'livekit' : 'p2p';
    return liveKitConfigured() ? 'livekit' : 'p2p';
}

function p2pIceServers() {
    const servers = [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ];
    if (process.env.STUDIO_TURN_URL) {
        servers.push({
            urls: String(process.env.STUDIO_TURN_URL).split(',').map(item => item.trim()).filter(Boolean),
            username: process.env.STUDIO_TURN_USERNAME || '',
            credential: process.env.STUDIO_TURN_CREDENTIAL || '',
        });
    }
    return servers;
}

class StudioLiveTransport {
    describe() {
        const provider = preferredProvider();
        return {
            provider,
            scalable: provider === 'livekit',
            fallback: provider === 'livekit' ? 'p2p' : null,
            turnConfigured: provider === 'livekit' || Boolean(process.env.STUDIO_TURN_URL),
            maxRecommendedViewers: provider === 'livekit' ? 3000 : 6,
        };
    }

    roomDescriptor() {
        const config = this.describe();
        return {
            provider: config.provider,
            scalable: config.scalable,
            createdAt: Date.now(),
        };
    }

    async join(room, actor) {
        const provider = room?.transport?.provider || preferredProvider();
        if (provider !== 'livekit' || !liveKitConfigured()) {
            return {
                provider: 'p2p',
                rtcConfig: { iceServers: p2pIceServers() },
                turnConfigured: Boolean(process.env.STUDIO_TURN_URL),
                fallbackReason: provider === 'livekit' ? 'livekit_not_configured' : '',
            };
        }
        const identity = String(actor?.userId || actor?.id || '').trim();
        if (!identity) throw new Error('Live transport requires an authenticated participant');
        const isHost = identity === room.authorId;
        const token = new AccessToken(
            process.env.LIVEKIT_API_KEY,
            process.env.LIVEKIT_API_SECRET,
            {
                identity,
                name: actor.displayName || actor.name || actor.handle || identity,
                ttl: 15 * 60,
                metadata: JSON.stringify({ studioRoomId: room.id, role: isHost ? 'host' : 'viewer' }),
            },
        );
        token.addGrant({
            room: room.id,
            roomJoin: true,
            canPublish: isHost,
            canPublishData: true,
            canSubscribe: true,
            canUpdateOwnMetadata: true,
            roomAdmin: isHost,
        });
        return {
            provider: 'livekit',
            url: String(process.env.LIVEKIT_URL).trim(),
            token: await token.toJwt(),
            roomName: room.id,
            role: isHost ? 'host' : 'viewer',
            adaptiveStream: true,
            dynacast: true,
        };
    }
}

export { p2pIceServers };
export default new StudioLiveTransport();
