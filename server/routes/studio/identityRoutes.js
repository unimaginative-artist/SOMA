import aiCohortVerificationEngine from "../../../core/AiCohortVerificationEngine.js";
/** Register portable identity, device sessions, LAN pairing, and verification routes. */
export default function registerStudioIdentityRoutes(router, {
    PAIRING_TTL_MS,
    STUDIO_SESSIONS_FILE,
    USER_REGISTRY_FILE,
    actorFromSession,
    axisProfileStore,
    codeHash,
    createPairingCode,
    createProtectedPublicHandle,
    createStudioUserId,
    crypto,
    deviceInfoFromReq,
    hashSecret,
    isLegacySecretHash,
    isPortableStudioId,
    isRestrictedActor,
    isTrustedLocalRequest,
    issueSession,
    loadProfile,
    normalizeAgeBand,
    normalizeTrustTier,
    normalizeUsername,
    pairingRegistry,
    platformAuthorityOk,
    publicDeviceSession,
    publicIdentityUser,
    publicPairing,
    publicStudioUser,
    recordRiskEvent,
    rejectRawVerificationMedia,
    resolveActor,
    riskEventRegistry,
    safetyAliasRequired,
    safetyProfile,
    saveProfile,
    sessionRegistry,
    studioUsers,
    usernameRegistry,
    usernameStatus,
    verificationStatusFor,
    verifySecret,
    writeJsonSafe,
    writePairingRegistry,
}) {
    router.get('/identity/check', (req, res) => {
        try {
            res.json(usernameStatus(req.query.username, req.query.currentUserId || ''));
        } catch (e) {
            res.status(500).json({ ok: false, available: false, error: e.message });
        }
    });

    router.post('/identity/register', (req, res) => {
        try {
            const profile = loadProfile();
            const requestedUserId = isPortableStudioId(req.body?.currentUserId) ? String(req.body.currentUserId) : '';
            const currentActor = actorFromSession(req);
            const currentUserId = requestedUserId && (isTrustedLocalRequest(req) || currentActor?.userId === requestedUserId)
                ? requestedUserId
                : '';
            const initialTrustTier = 'UNKNOWN';
            const initialAgeBand = 'unknown';
            const registry = usernameRegistry();
            const protectedAlias = safetyAliasRequired(initialTrustTier, initialAgeBand);
            const requestedStatus = usernameStatus(req.body?.username, currentUserId);
            const handle = protectedAlias ? createProtectedPublicHandle(registry) : requestedStatus.handle;
            if (!protectedAlias && !requestedStatus.available) return res.status(409).json(requestedStatus);
            const passcode = String(req.body?.passcode || '').trim();
            if (passcode.length < 10) return res.status(400).json({ ok: false, reason: 'Use a passcode with at least 10 characters.' });

            const userId = currentUserId || createStudioUserId();
            const displayName = String(req.body?.displayName || profile.name || handle).trim() || handle;
            registry.users[handle] = {
                userId,
                handle,
                displayName,
                passcodeHash: hashSecret(passcode),
                requestedHandle: protectedAlias ? requestedStatus.handle || normalizeUsername(req.body?.username) : undefined,
                protectedAlias,
                accountType: 'human',
                trustTier: initialTrustTier,
                ageBand: initialAgeBand,
                createdAt: registry.users[handle]?.createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            writeJsonSafe(USER_REGISTRY_FILE, registry);

            const savedProfile = saveProfile({
                ...profile,
                name: displayName,
                axis: {
                    ...(profile.axis || {}),
                    handle,
                    displayName,
                    userId,
                    color: profile.axis?.color || req.body?.color || 'violet',
                    status: profile.axis?.status || 'online',
                },
                publicIdentity: {
                    ...(profile.publicIdentity || {}),
                    handle,
                },
                studio: {
                    ...(profile.studio || {}),
                    identity: {
                        ...(profile.studio?.identity || {}),
                        registered: true,
                        userId,
                        handle,
                        displayName,
                        protectedAlias,
                        requestedHandle: protectedAlias ? requestedStatus.handle || normalizeUsername(req.body?.username) : undefined,
                        trustTier: initialTrustTier,
                        ageBand: initialAgeBand,
                        registeredAt: profile.studio?.identity?.registeredAt || Date.now(),
                    },
                },
            });

            axisProfileStore.recordActivity({
                type: 'studio_identity_registered',
                title: 'Studio identity registered',
                summary: `@${handle} registered as the portable Studio identity.`,
                source: 'studio-identity',
                metadata: { userId, handle },
            }, savedProfile);

            studioUsers.upsert({
                id: userId,
                handle,
                name: displayName,
                avatar: savedProfile.avatar || '',
                bio: savedProfile.bio || '',
                role: savedProfile.role || '',
                accountType: 'human',
                agent: false,
                verified: true,
                protectedAlias,
                trustTier: initialTrustTier,
                ageBand: initialAgeBand,
            });

            const actor = publicIdentityUser({ userId, handle, displayName, avatar: savedProfile.avatar || '', color: savedProfile.axis?.color || 'violet', trustTier: initialTrustTier, ageBand: initialAgeBand });
            const issued = issueSession(actor, req);
            res.json({ ok: true, user: actor, token: issued.token, session: issued.session, profile: savedProfile, protectedAlias });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/login', (req, res) => {
        try {
            const handle = normalizeUsername(req.body?.username);
            const passcode = String(req.body?.passcode || '').trim();
            const profile = loadProfile();
            const registry = usernameRegistry();
            const registered = registry.users[handle];
            const profileHandle = normalizeUsername(profile.axis?.handle || profile.publicIdentity?.handle || profile.name);
            const profileUserId = profile.axis?.userId || profile.studio?.identity?.userId || '';
            const trustedLocal = isTrustedLocalRequest(req);
            const matchesProfile = trustedLocal && handle && handle === profileHandle;

            if (!registered && !matchesProfile) {
                return res.status(404).json({ ok: false, reason: 'No Studio identity found for that username.' });
            }
            if (registered?.localOwner && !registered?.passcodeHash && !trustedLocal) {
                return res.status(403).json({ ok: false, reason: 'Local owner devices must be approved through Command Bridge pairing.' });
            }
            if (registered?.passcodeHash && !verifySecret(passcode, registered.passcodeHash)) {
                return res.status(401).json({ ok: false, reason: 'Passcode does not match.' });
            }
            if (!registered?.passcodeHash && passcode.length < 4) {
                return res.status(400).json({ ok: false, reason: 'Enter a passcode to protect this local identity.' });
            }

            const userId = isPortableStudioId(registered?.userId)
                ? registered.userId
                : isPortableStudioId(profileUserId)
                    ? profileUserId
                    : createStudioUserId();
            const displayName = registered?.displayName || profile.axis?.displayName || profile.name || handle;
            registry.users[handle] = {
                ...(registered || {}),
                userId,
                handle,
                displayName,
                passcodeHash: (!registered?.passcodeHash || isLegacySecretHash(registered.passcodeHash)) ? hashSecret(passcode) : registered.passcodeHash,
                accountType: registered?.accountType || 'human',
                trustTier: registered?.trustTier || 'UNKNOWN',
                ageBand: registered?.ageBand || 'unknown',
                createdAt: registered?.createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            writeJsonSafe(USER_REGISTRY_FILE, registry);

            const savedProfile = saveProfile({
                ...profile,
                name: displayName,
                axis: {
                    ...(profile.axis || {}),
                    handle,
                    displayName,
                    userId,
                    color: profile.axis?.color || 'violet',
                    status: profile.axis?.status || 'online',
                },
                publicIdentity: {
                    ...(profile.publicIdentity || {}),
                    handle,
                },
                studio: {
                    ...(profile.studio || {}),
                    identity: {
                        ...(profile.studio?.identity || {}),
                        registered: true,
                        userId,
                        handle,
                        displayName,
                    },
                },
            });

            studioUsers.upsert({
                id: userId,
                handle,
                name: displayName,
                avatar: savedProfile.avatar || '',
                bio: savedProfile.bio || '',
                role: savedProfile.role || '',
                accountType: registry.users[handle].accountType || 'human',
                agent: registry.users[handle].accountType === 'bot',
                verified: true,
                trustTier: registry.users[handle].trustTier,
                ageBand: registry.users[handle].ageBand,
            });

            const actor = publicIdentityUser({
                userId,
                handle,
                displayName,
                avatar: savedProfile.avatar || '',
                color: savedProfile.axis?.color || 'violet',
                trustTier: registry.users[handle].trustTier,
                ageBand: registry.users[handle].ageBand,
            });
            const issued = issueSession(actor, req);
            res.json({ ok: true, user: actor, token: issued.token, session: issued.session, profile: savedProfile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/bootstrap', (req, res) => {
        try {
            if (!isTrustedLocalRequest(req)) {
                return res.status(403).json({ ok: false, error: 'Auto-bootstrap is only available on local/trusted home LAN.' });
            }
            const profile = loadProfile();
            const localActor = resolveActor(req) || actorFromSession(req);
            const registry = usernameRegistry();
            let user = localActor;
            if (!user) {
                const ownerEntry = Object.values(registry.users || {}).find(u => u.localOwner || u.handle === 'calm_harbor_7431' || u.displayName === 'Owner') || Object.values(registry.users || {})[0];
                if (ownerEntry) {
                    user = publicIdentityUser({
                        userId: ownerEntry.userId,
                        id: ownerEntry.userId,
                        handle: ownerEntry.handle,
                        displayName: ownerEntry.displayName,
                        name: ownerEntry.displayName,
                        avatar: profile.avatar || '',
                        color: profile.axis?.color || 'violet',
                        trustTier: ownerEntry.trustTier || 'ADULT_VERIFIED',
                        ageBand: ownerEntry.ageBand || 'mature_adult',
                        localOwner: true,
                    });
                }
            }
            if (!user) {
                return res.status(404).json({ ok: false, error: 'No local owner identity found to bootstrap.' });
            }
            const uid = user.userId || user.id;
            const stored = studioUsers.get(uid) || {};
            const enrichedUser = {
                ...user,
                trustTier: (stored.trustTier && stored.trustTier !== 'UNKNOWN') ? stored.trustTier : (user.trustTier && user.trustTier !== 'UNKNOWN' ? user.trustTier : 'HUMAN_VERIFIED_MATURE'),
                ageBand: (stored.ageBand && stored.ageBand !== 'unknown') ? stored.ageBand : (user.ageBand && user.ageBand !== 'unknown' ? user.ageBand : 'mature_adult'),
            };
            const issued = issueSession(publicIdentityUser(enrichedUser), req);
            res.json({
                ok: true,
                user: publicIdentityUser(enrichedUser),
                token: issued.token,
                session: issued.session,
                profile: loadProfile(),
                bootstrapped: true,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/session', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            res.json({ ok: true, user: publicIdentityUser(actor), profile: loadProfile() });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/devices', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const nowMs = Date.now();
            const sessions = sessionRegistry().sessions
                .filter(item => item.userId === actor.userId && Number(item.expiresAt || 0) > nowMs)
                .sort((a, b) => Number(b.lastSeenAt || b.createdAt || 0) - Number(a.lastSeenAt || a.createdAt || 0))
                .map(publicDeviceSession);
            res.json({ ok: true, sessions });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/pairing/start', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const mode = String(req.body?.mode || 'lan').trim().toLowerCase();
            if (!['lan', 'manual'].includes(mode)) {
                return res.status(400).json({ ok: false, error: 'Only LAN/manual pairing is enabled.' });
            }
            // Short id: it's an identifier the user types on a phone, not a secret —
            // the 6-digit code + owner approval + attempt lockout are the security.
            let pairingId = `pair-${crypto.randomBytes(5).toString('hex')}`;
            while (pairingRegistry().pairings.some(item => item.pairingId === pairingId)) {
                pairingId = `pair-${crypto.randomBytes(5).toString('hex')}`;
            }
            const code = createPairingCode();
            const nowMs = Date.now();
            const starterDevice = deviceInfoFromReq(req);
            const pairing = {
                pairingId,
                userId: actor.userId,
                handle: actor.handle || '',
                displayName: actor.displayName || actor.name || actor.handle || '',
                mode,
                status: 'pending',
                codeHash: codeHash(pairingId, code),
                starterSessionId: actor.sessionId || '',
                starterDeviceId: actor.deviceId || starterDevice.deviceId || '',
                starterIpHash: starterDevice.ipHash,
                starterNetwork: starterDevice.network,
                createdAt: nowMs,
                expiresAt: nowMs + PAIRING_TTL_MS,
                requestedAt: null,
                approvedAt: null,
                completedAt: null,
                phoneDevice: null,
                issuedToken: null,
                issuedSession: null,
                attempts: 0,
            };
            const db = pairingRegistry();
            db.pairings.push(pairing);
            writePairingRegistry(db);
            recordRiskEvent({
                userId: actor.userId,
                sessionId: actor.sessionId || '',
                type: 'pairing_started',
                severity: 'info',
                riskFlags: [],
                deviceId: pairing.starterDeviceId,
                deviceType: starterDevice.deviceType,
            });
            res.json({
                ok: true,
                pairing: publicPairing(pairing),
                code,
                qrPayload: {
                    type: 'studio-device-pairing',
                    pairingId,
                    mode,
                    path: `/api/studio/identity/pairing/${pairingId}`,
                    expiresAt: pairing.expiresAt,
                },
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/pairing/:pairingId', (req, res) => {
        try {
            const db = pairingRegistry();
            const pairing = db.pairings.find(item => item.pairingId === req.params.pairingId);
            if (!pairing) return res.status(404).json({ ok: false, error: 'Pairing request not found.' });
            if (Number(pairing.expiresAt || 0) < Date.now() && !['completed'].includes(pairing.status)) pairing.status = 'expired';
            writePairingRegistry(db);
            res.json({ ok: true, pairing: publicPairing(pairing) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/pairing/:pairingId/request', (req, res) => {
        try {
            const code = String(req.body?.code || '').trim();
            const db = pairingRegistry();
            const pairing = db.pairings.find(item => item.pairingId === req.params.pairingId);
            if (!pairing) return res.status(404).json({ ok: false, error: 'Pairing request not found.' });
            if (Number(pairing.expiresAt || 0) < Date.now()) return res.status(410).json({ ok: false, error: 'Pairing request expired.' });
            if (!['pending', 'requested'].includes(pairing.status)) return res.status(409).json({ ok: false, error: `Pairing is ${pairing.status}.` });
            pairing.attempts = Number(pairing.attempts || 0) + 1;
            if (pairing.attempts > 10) {
                pairing.status = 'locked';
                writePairingRegistry(db);
                return res.status(429).json({ ok: false, error: 'Too many pairing attempts.' });
            }
            if (!code || codeHash(pairing.pairingId, code) !== pairing.codeHash) {
                writePairingRegistry(db);
                return res.status(401).json({ ok: false, error: 'Pairing code does not match.' });
            }
            const phoneDevice = deviceInfoFromReq(req);
            // "Same network" = same IP (same machine) OR both on local networks
            // (loopback/RFC1918). The Command Bridge starter hits the backend as
            // 127.0.0.1 while a phone arrives with its LAN address, so strict IP
            // equality would reject every real phone.
            const starterNetwork = pairing.starterNetwork || 'unknown';
            const sameNetwork = phoneDevice.ipHash === pairing.starterIpHash
                || (['loopback', 'private'].includes(starterNetwork) && ['loopback', 'private'].includes(phoneDevice.network));
            if (pairing.mode === 'lan' && pairing.starterIpHash && !sameNetwork) {
                writePairingRegistry(db);
                recordRiskEvent({
                    userId: pairing.userId,
                    sessionId: pairing.starterSessionId || '',
                    type: 'pairing_network_mismatch',
                    severity: 'medium',
                    riskFlags: ['pairing_network_mismatch'],
                    deviceId: phoneDevice.deviceId,
                    deviceType: phoneDevice.deviceType,
                });
                return res.status(403).json({ ok: false, error: 'Phone must be on the same network for LAN pairing.' });
            }
            pairing.status = 'requested';
            pairing.requestedAt = Date.now();
            pairing.phoneDevice = phoneDevice;
            writePairingRegistry(db);
            recordRiskEvent({
                userId: pairing.userId,
                sessionId: pairing.starterSessionId || '',
                type: 'pairing_requested',
                severity: 'info',
                riskFlags: [],
                deviceId: phoneDevice.deviceId,
                deviceType: phoneDevice.deviceType,
            });
            res.json({ ok: true, pairing: publicPairing(pairing) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/pairing/:pairingId/approve', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const db = pairingRegistry();
            const pairing = db.pairings.find(item => item.pairingId === req.params.pairingId);
            if (!pairing) return res.status(404).json({ ok: false, error: 'Pairing request not found.' });
            if (pairing.userId !== actor.userId) return res.status(403).json({ ok: false, error: 'Pairing belongs to a different account.' });
            if (Number(pairing.expiresAt || 0) < Date.now()) return res.status(410).json({ ok: false, error: 'Pairing request expired.' });
            if (pairing.status !== 'requested' || !pairing.phoneDevice) return res.status(409).json({ ok: false, error: 'No phone is waiting for approval.' });
            const issued = issueSession(publicIdentityUser(actor), req, pairing.phoneDevice);
            pairing.status = 'approved';
            pairing.approvedAt = Date.now();
            pairing.issuedToken = issued.token;
            pairing.issuedSession = issued.session;
            writePairingRegistry(db);
            recordRiskEvent({
                userId: actor.userId,
                sessionId: actor.sessionId || '',
                type: 'pairing_approved',
                severity: 'info',
                riskFlags: [],
                deviceId: pairing.phoneDevice.deviceId,
                deviceType: pairing.phoneDevice.deviceType,
            });
            res.json({ ok: true, pairing: publicPairing(pairing), session: issued.session });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/pairing/:pairingId/complete', (req, res) => {
        try {
            const code = String(req.body?.code || '').trim();
            const db = pairingRegistry();
            const pairing = db.pairings.find(item => item.pairingId === req.params.pairingId);
            if (!pairing) return res.status(404).json({ ok: false, error: 'Pairing request not found.' });
            if (Number(pairing.expiresAt || 0) < Date.now()) return res.status(410).json({ ok: false, error: 'Pairing request expired.' });
            if (pairing.status !== 'approved' || !pairing.issuedToken) return res.status(409).json({ ok: false, error: 'Pairing has not been approved.' });
            if (!code || codeHash(pairing.pairingId, code) !== pairing.codeHash) return res.status(401).json({ ok: false, error: 'Pairing code does not match.' });
            const completingDevice = deviceInfoFromReq(req);
            if (!pairing.phoneDevice || completingDevice.deviceId !== pairing.phoneDevice.deviceId || completingDevice.ipHash !== pairing.phoneDevice.ipHash) {
                recordRiskEvent({
                    userId: pairing.userId,
                    sessionId: pairing.starterSessionId || '',
                    type: 'pairing_completion_device_mismatch',
                    severity: 'high',
                    riskFlags: ['pairing_device_mismatch'],
                    deviceId: completingDevice.deviceId,
                    deviceType: completingDevice.deviceType,
                });
                return res.status(403).json({ ok: false, error: 'Pairing must be completed by the approved device on the same network.' });
            }
            const person = studioUsers.get(pairing.userId) || {};
            const registered = Object.values(usernameRegistry().users || {}).find(user => user.userId === pairing.userId);
            const user = publicIdentityUser({
                userId: pairing.userId,
                handle: registered?.handle || pairing.handle || person.handle || '',
                displayName: registered?.displayName || pairing.displayName || person.name || pairing.userId,
                name: registered?.displayName || pairing.displayName || person.name || pairing.userId,
                avatar: person.avatar || '',
                color: person.color || 'violet',
                trustTier: registered?.trustTier || person.trustTier || 'UNKNOWN',
                ageBand: registered?.ageBand || person.ageBand || 'unknown',
            });
            const token = pairing.issuedToken;
            const session = pairing.issuedSession;
            pairing.status = 'completed';
            pairing.completedAt = Date.now();
            pairing.issuedToken = null;
            writePairingRegistry(db);
            recordRiskEvent({
                userId: pairing.userId,
                sessionId: session?.sessionId || '',
                type: 'pairing_completed',
                severity: 'info',
                riskFlags: [],
                deviceId: session?.deviceId || '',
                deviceType: session?.deviceType || '',
            });
            res.json({ ok: true, user, token, session });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/identity/devices/:sessionId', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const db = sessionRegistry();
            const session = db.sessions.find(item => item.sessionId === req.params.sessionId && item.userId === actor.userId);
            if (!session) return res.status(404).json({ ok: false, error: 'Device session not found.' });
            if (!session.revokedAt) session.revokedAt = Date.now();
            writeJsonSafe(STUDIO_SESSIONS_FILE, db);
            recordRiskEvent({
                userId: actor.userId,
                sessionId: session.sessionId,
                type: 'device_session_revoked',
                severity: 'info',
                riskFlags: [],
                deviceId: session.deviceId,
                deviceType: session.deviceType,
            });
            res.json({ ok: true, session: publicDeviceSession(session) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/risk-events', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const events = riskEventRegistry().events
                .filter(item => item.userId === actor.userId)
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                .slice(0, Math.min(Number(req.query.limit) || 100, 500));
            res.json({ ok: true, events });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/me', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const user = studioUsers.get(actor.userId) || {};
            res.json({
                ok: true,
                user: publicIdentityUser(actor),
                verification: verificationStatusFor({ ...user, ...actor, id: actor.userId }),
                restricted: isRestrictedActor(actor),
                permissions: {
                    canPost: !isRestrictedActor(actor),
                    canFollow: !safetyProfile(actor).isUnknownAge && !isRestrictedActor(actor),
                    canDiscoverUsers: !safetyProfile(actor).isUnknownAge,
                    canViewMinors: safetyProfile(actor).isMinor,
                    canViewAdults: !safetyProfile(actor).isMinor && !safetyProfile(actor).isUnknownAge,
                },
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/verification/status', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const user = studioUsers.get(actor.userId) || {};
            res.json({ ok: true, verification: verificationStatusFor({ ...actor, ...user, id: actor.userId }) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/verification/attestation', (req, res) => {
        try {
            const trusted = platformAuthorityOk(req);
            if (!trusted) return res.status(403).json({ ok: false, error: 'Verification attestation authority required.' });
            rejectRawVerificationMedia(req.body || {});
            const userId = String(req.body?.userId || '').trim();
            if (!userId) return res.status(400).json({ ok: false, error: 'userId is required.' });
            const user = studioUsers.get(userId);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });

            const trustTier = normalizeTrustTier(req.body?.trustTier);
            const ageBand = normalizeAgeBand(req.body?.ageBand, trustTier);
            const safety = safetyProfile({ trustTier, ageBand });
            if (safety.isUnknownAge) return res.status(400).json({ ok: false, error: 'Attestation must resolve ageBand/trustTier.' });

            const nowMs = Date.now();
            const expiresAt = Number(req.body?.expiresAt || req.body?.verificationExpiresAt || 0) || (nowMs + 1000 * 60 * 60 * 24 * 365);
            const updated = studioUsers.upsert({
                ...user,
                trustTier,
                ageBand,
                verified: safety.isVerified,
                verificationProvider: String(req.body?.provider || 'external').slice(0, 80),
                verificationRef: String(req.body?.verificationRef || '').slice(0, 160),
                verificationEvidenceHash: String(req.body?.evidenceHash || '').slice(0, 160),
                verifiedAt: nowMs,
                verificationExpiresAt: expiresAt,
                visibilityLimited: safety.isUnknownAge ? true : Boolean(user.visibilityLimited && req.body?.clearRestriction !== true),
            });

            const registry = usernameRegistry();
            for (const [handle, record] of Object.entries(registry.users || {})) {
                if (record.userId === userId) {
                    registry.users[handle] = { ...record, trustTier, ageBand, updatedAt: nowMs };
                }
            }
            writeJsonSafe(USER_REGISTRY_FILE, registry);
            res.json({ ok: true, user: publicStudioUser(updated), verification: verificationStatusFor(updated) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/verification/proof-of-human', (req, res) => {
        try {
            rejectRawVerificationMedia(req.body || {});
            const actor = actorFromSession(req);
            const userId = String(req.body?.userId || actor?.userId || '').trim();
            if (!userId) return res.status(400).json({ ok: false, error: 'Authentication or userId required for Proof-of-Human.' });

            const user = studioUsers.get(userId);
            if (!user) return res.status(404).json({ ok: false, error: 'User profile not found.' });

            const birthDate = String(req.body?.birthDate || '').trim();
            if (!birthDate || isNaN(Date.parse(birthDate))) {
                return res.status(400).json({ ok: false, error: 'Valid birthDate (YYYY-MM-DD) is required for age cohorting.' });
            }

            const docHash = String(req.body?.documentEvidenceHash || '').trim();
            const faceHash = String(req.body?.faceVectorHash || '').trim();
            const livenessScore = Number(req.body?.faceLivenessScore || 0);

            if (!docHash || !faceHash) {
                return res.status(400).json({ ok: false, error: 'Cryptographic documentEvidenceHash and faceVectorHash are required.' });
            }
            if (livenessScore < 0.80) {
                return res.status(400).json({ ok: false, error: `Live face selfie verification failed (score: ${(livenessScore * 100).toFixed(1)}% < 80%). Please retry the 3D liveness challenge.` });
            }

            // Calculate age precisely
            const dob = new Date(birthDate);
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const m = today.getMonth() - dob.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
                age--;
            }

            if (age < 18) {
                return res.status(403).json({ ok: false, eligible: false, error: 'Studio is strictly an 18+ intrapersonal network. Underage accounts cannot be verified.' });
            }

            // Determine demographic age cohort
            let ageBand = 'core_adult';
            let trustTier = 'HUMAN_VERIFIED_CORE';
            let cohortLabel = 'Core Adult (23-35)';

            if (age <= 22) {
                ageBand = 'young_adult';
                trustTier = 'HUMAN_VERIFIED_YOUNG';
                cohortLabel = 'Young Adult (18-22)';
            } else if (age >= 36) {
                ageBand = 'mature_adult';
                trustTier = 'HUMAN_VERIFIED_MATURE';
                cohortLabel = 'Mature Adult (36+)';
            }

            const nowMs = Date.now();
            const expiresAt = nowMs + 1000 * 60 * 60 * 24 * 365; // 1 year validity
            const proofDigest = crypto.createHash('sha256').update(`${docHash}:${faceHash}:${userId}`).digest('hex');

            const updated = studioUsers.upsert({
                ...user,
                trustTier,
                ageBand,
                verified: true,
                isHumanVerified: true,
                proofOfHumanDigest: proofDigest,
                verificationProvider: 'soma-liveness-sentinel',
                verificationRef: `poh-${ageBand}-${Date.now().toString(36)}`,
                verificationEvidenceHash: proofDigest,
                verifiedAt: nowMs,
                verificationExpiresAt: expiresAt,
                visibilityLimited: false,
            });

            const registry = usernameRegistry();
            for (const [handle, record] of Object.entries(registry.users || {})) {
                if (record.userId === userId) {
                    registry.users[handle] = { ...record, trustTier, ageBand, isHumanVerified: true, updatedAt: nowMs };
                }
            }
            writeJsonSafe(USER_REGISTRY_FILE, registry);

            res.json({
                ok: true,
                verified: true,
                isHumanVerified: true,
                age,
                cohort: ageBand,
                cohortLabel,
                trustTier,
                proofDigest,
                user: publicStudioUser(updated),
                verification: verificationStatusFor(updated)
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post("/verification/ai-verify", async (req, res) => {
        try {
            const actor = actorFromSession(req);
            const userId = String(req.body?.userId || actor?.userId || "").trim();
            if (!userId) return res.status(400).json({ ok: false, error: "Authentication or userId required for AI verification." });

            const user = studioUsers.get(userId);
            if (!user) return res.status(404).json({ ok: false, error: "User profile not found." });

            const result = await aiCohortVerificationEngine.verifyHumanCohort({
                userId,
                birthDate: req.body?.birthDate,
                idCardBase64: req.body?.idCardBase64,
                selfieBase64: req.body?.selfieBase64,
                documentEvidenceHash: req.body?.documentEvidenceHash,
                faceVectorHash: req.body?.faceVectorHash,
                faceLivenessScore: req.body?.faceLivenessScore ?? 0.95
            });

            if (!result.success || !result.eligible || result.blocked) {
                return res.status(403).json({
                    ok: false,
                    eligible: false,
                    blocked: true,
                    age: result.age,
                    cohort: result.cohort,
                    trustTier: result.trustTier,
                    error: result.error || "Verification failed."
                });
            }

            const nowMs = Date.now();
            const updated = studioUsers.upsert({
                ...user,
                trustTier: result.trustTier,
                ageBand: result.cohort,
                verified: true,
                isHumanVerified: true,
                aiVerified: true,
                aiAttestationDigest: result.attestation?.attestationDigest,
                verificationProvider: "soma-ai-vision-sentinel",
                verificationRef: `ai-${result.cohort}-${nowMs.toString(36)}`,
                verifiedAt: nowMs,
                verificationExpiresAt: nowMs + 1000 * 60 * 60 * 24 * 365,
                visibilityLimited: false
            });

            const registry = usernameRegistry();
            for (const [handle, record] of Object.entries(registry.users || {})) {
                if (record.userId === userId) {
                    registry.users[handle] = {
                        ...record,
                        trustTier: result.trustTier,
                        ageBand: result.cohort,
                        isHumanVerified: true,
                        aiVerified: true,
                        updatedAt: nowMs
                    };
                }
            }
            writeJsonSafe(USER_REGISTRY_FILE, registry);

            res.json({
                ok: true,
                verified: true,
                isHumanVerified: true,
                aiVerified: true,
                age: result.age,
                cohort: result.cohort,
                cohortLabel: result.cohortLabel,
                trustTier: result.trustTier,
                attestation: result.attestation,
                user: publicStudioUser(updated),
                verification: verificationStatusFor(updated)
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

}
