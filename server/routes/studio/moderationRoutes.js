/** Register safety policy, moderation, scam scanning, bans, and account disclosure routes. */
export default function registerStudioModerationRoutes(router, {
    STUDIO_RATE_BUCKETS,
    TRUST_TIERS,
    USER_REGISTRY_FILE,
    banStudioUser,
    botDisclosureFor,
    canViewUser,
    computeBehaviorRisk,
    normalizeAccountType,
    normalizeAgeBand,
    normalizeTrustTier,
    platformAuthorityOk,
    publicIdentityUser,
    publicSecurityScan,
    publicStudioUser,
    recordDirectSecurityScan,
    recordRiskEvent,
    resolveActor,
    safetyProfile,
    scanDirectForScam,
    securityRegistry,
    studioUsers,
    usernameRegistry,
    writeJsonSafe,
    writeSecurityRegistry,
}) {
    router.get('/safety/policy', (_req, res) => {
        res.json({
            ok: true,
            tiers: Array.from(TRUST_TIERS),
            rules: {
                unknown: 'Authenticated but not discoverable; cannot follow, DM, or browse social users until age is resolved.',
                adult_unverified: 'Adult-safe surfaces only; cannot see, contact, follow, recommend, or be recommended to minors.',
                adult_verified: 'Verified adult surfaces only; still cannot see, contact, follow, recommend, or be recommended to minors.',
                minor_verified: 'Can only see and be seen by verified minor accounts and moderated youth spaces.',
                minor_protected_u13: 'Guardian-consent protected; can only see protected under-13 spaces/users.',
            },
        });
    });

    router.get('/security/status', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const db = securityRegistry();
            res.json({
                ok: true,
                gateway: {
                    active: true,
                    rateBuckets: STUDIO_RATE_BUCKETS.size,
                    directsScanned: true,
                    ipPolicy: 'risk signal first; temporary block only unless attack infrastructure is confirmed',
                },
                bannedUsers: db.bannedUsers.filter(item => !item.revokedAt).map(item => ({
                    userId: item.userId,
                    reason: item.reason,
                    createdAt: item.createdAt,
                    evidence: item.evidence || {},
                })),
                ipBlocks: db.ipBlocks.filter(item => !item.revokedAt && (!item.expiresAt || Number(item.expiresAt) > Date.now())),
                recentDirectScans: db.directScans.slice(-50).reverse().map(publicSecurityScan),
                counters: db.counters,
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/security/directs/scan', (req, res) => {
        try {
            const actor = resolveActor(req);
            const scan = scanDirectForScam({
                ...(req.body || {}),
                senderUserId: req.body?.senderUserId || actor?.userId || req.body?.userId || '',
            }, req);
            if (scan.verdict !== 'allow') recordDirectSecurityScan(scan, req);
            res.json({
                ok: true,
                scan: publicSecurityScan(scan),
                action: scan.verdict === 'allow'
                    ? 'deliver'
                    : scan.verdict === 'flag'
                        ? 'deliver_with_warning'
                        : 'quarantine_before_delivery',
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/security/users/:id/ban', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const ban = banStudioUser(req.params.id, String(req.body?.reason || 'manual_platform_ban'), {
                source: 'manual_security_action',
                note: String(req.body?.note || '').slice(0, 500),
            });
            res.json({ ok: true, ban });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/security/users/:id/unban', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const db = securityRegistry();
            const nowMs = Date.now();
            let changed = false;
            for (const ban of db.bannedUsers) {
                if (ban.userId === req.params.id && !ban.revokedAt) {
                    ban.revokedAt = nowMs;
                    ban.revokedReason = String(req.body?.reason || 'manual_unban');
                    changed = true;
                }
            }
            writeSecurityRegistry(db);
            const user = studioUsers.get(req.params.id);
            if (user) {
                studioUsers.upsert({
                    ...user,
                    visibilityLimited: Boolean(req.body?.keepLimited),
                    bannedAt: null,
                    banReason: null,
                });
            }
            recordRiskEvent({
                userId: req.params.id,
                sessionId: '',
                type: 'studio_user_unbanned',
                severity: 'medium',
                riskFlags: [],
                deviceId: '',
                deviceType: 'account',
            });
            res.json({ ok: true, changed });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/safety/audit', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const users = studioUsers.list();
            const audits = users.map(user => ({
                userId: user.id,
                handle: user.handle,
                name: user.name,
                trustTier: normalizeTrustTier(user.trustTier),
                ageBand: normalizeAgeBand(user.ageBand, user.trustTier),
                visibilityLimited: Boolean(user.visibilityLimited),
                behaviorRisk: computeBehaviorRisk(user.id),
            })).sort((a, b) => b.behaviorRisk.score - a.behaviorRisk.score);
            res.json({ ok: true, audits });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/safety/audit/run', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const threshold = Math.max(0, Math.min(100, Number(req.body?.restrictThreshold ?? 70)));
            const reviewed = [];
            for (const user of studioUsers.list()) {
                const behaviorRisk = computeBehaviorRisk(user.id);
                const restricted = behaviorRisk.score >= threshold;
                const updated = studioUsers.upsert({
                    ...user,
                    behaviorRisk,
                    safetyFlags: behaviorRisk.flags,
                    safetyAuditedAt: Date.now(),
                    visibilityLimited: restricted || Boolean(user.visibilityLimited && req.body?.clear !== true),
                });
                reviewed.push({
                    userId: updated.id,
                    handle: updated.handle,
                    behaviorRisk,
                    visibilityLimited: Boolean(updated.visibilityLimited),
                });
            }
            reviewed.sort((a, b) => b.behaviorRisk.score - a.behaviorRisk.score);
            res.json({ ok: true, reviewed });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.put('/users/:id/safety', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const trustTier = normalizeTrustTier(req.body?.trustTier);
            const ageBand = normalizeAgeBand(req.body?.ageBand, trustTier);
            const updated = studioUsers.upsert({
                ...user,
                trustTier,
                ageBand,
                verified: safetyProfile({ trustTier, ageBand }).isVerified,
                safetyUpdatedAt: Date.now(),
                verificationExpiresAt: req.body?.verificationExpiresAt || user.verificationExpiresAt || null,
                verificationProvider: req.body?.verificationProvider || user.verificationProvider || 'manual-local-owner',
            });
            const registry = usernameRegistry();
            for (const [handle, record] of Object.entries(registry.users || {})) {
                if (record.userId === req.params.id) {
                    registry.users[handle] = { ...record, trustTier, ageBand, updatedAt: Date.now() };
                }
            }
            writeJsonSafe(USER_REGISTRY_FILE, registry);
            res.json({ ok: true, user: publicIdentityUser({ ...updated, userId: updated.id, displayName: updated.name }) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/users/:id/disclosure', (req, res) => {
        try {
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const actor = resolveActor(req);
            if (!canViewUser(actor, user)) return res.status(404).json({ ok: false, error: 'not found' });
            const publicUser = publicStudioUser(user);
            res.json({
                ok: true,
                userId: publicUser.id,
                handle: publicUser.handle,
                accountType: publicUser.accountType,
                agent: publicUser.agent,
                botDisclosure: publicUser.botDisclosure,
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.put('/users/:id/account-type', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const accountType = normalizeAccountType(req.body?.accountType);
            const disclosure = req.body?.botDisclosure && typeof req.body.botDisclosure === 'object' ? req.body.botDisclosure : {};
            const botDisclosure = botDisclosureFor({ ...user, accountType, botDisclosure: disclosure });
            if (accountType === 'bot' && !botDisclosure?.required) {
                return res.status(400).json({ ok: false, error: 'Bot accounts require disclosure.' });
            }
            const updated = studioUsers.upsert({
                ...user,
                accountType,
                agent: accountType === 'bot',
                botDisclosure,
                accountTypeUpdatedAt: Date.now(),
            });
            const registry = usernameRegistry();
            for (const [handle, record] of Object.entries(registry.users || {})) {
                if (record.userId === req.params.id) {
                    registry.users[handle] = { ...record, accountType, updatedAt: Date.now() };
                }
            }
            writeJsonSafe(USER_REGISTRY_FILE, registry);
            res.json({ ok: true, user: publicStudioUser(updated) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

}
