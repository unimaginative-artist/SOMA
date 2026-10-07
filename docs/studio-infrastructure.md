# Studio infrastructure

Studio runs peer-to-peer live rooms by default, with STUN only. That is suitable
for local development and very small rooms, but it is not the production
configuration.

## Reliable peer-to-peer rooms

Configure a TURN service (for example coturn):

```dotenv
STUDIO_LIVE_TRANSPORT=p2p
STUDIO_TURN_URL=turns:turn.example.com:5349?transport=tcp,turn:turn.example.com:3478?transport=udp
STUDIO_TURN_USERNAME=studio
STUDIO_TURN_CREDENTIAL=replace-with-a-secret
```

TURN credentials are returned only from the authenticated live transport
endpoint. They should be short-lived credentials in a public deployment.

## Larger rooms with LiveKit

When all three LiveKit variables exist, `auto` selects the SFU. Hosts receive a
publish grant; viewers receive a subscribe-only grant. Join tokens expire after
15 minutes.

```dotenv
STUDIO_LIVE_TRANSPORT=auto
LIVEKIT_URL=wss://live.example.com
LIVEKIT_API_KEY=replace-me
LIVEKIT_API_SECRET=replace-me
```

Deploy LiveKit with its advertised WebRTC ports reachable from viewers and a
TURN/TLS path for restrictive networks. P2P remains the local fallback when
LiveKit is not configured.

## Event ledger

The Studio/Axis event ledger is SQLite/WAL at
`SOMA/studio-axis-events.db`. Events carry schema IDs, idempotency keys,
retention, audience filters, and consumer replay checkpoints.

```dotenv
STUDIO_EVENT_RETENTION_MS=2592000000
STUDIO_EVENT_MAX_ROWS=50000
```

SDP and ICE events are deliberately ephemeral and are never written to disk.

## Media

Original uploads, thumbnails, HLS renditions, and the media job ledger live
under `SOMA/studio-media/`. The bundled FFmpeg is used unless `FFMPEG_PATH` is
set.

```dotenv
STUDIO_MEDIA_QUOTA_BYTES=5368709120
STUDIO_MEDIA_CHUNK_LIMIT=64mb
FFMPEG_PATH=
```

The resumable upload API records an exact byte offset. Interrupted clients can
query that offset, continue the same upload, and then finalize it into the
normal thumbnail/HLS job. Processing jobs recover after restart and have a
bounded retry endpoint.
