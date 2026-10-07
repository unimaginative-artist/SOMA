const BLOCK_LABELS = new Set(['porn', 'sexual', 'graphic-media', 'spam', '!hide', '!warn']);
const ADULT_OR_SCAM_RE = /(?:\b(?:airdrop|giveaway|free\s*money|onlyfans|nsfw|porn|sex|escort|casino|betting|loan|forex|crypto\s*signals?|whale\s*signals?|guaranteed\s*(?:profit|returns?)|pump|memecoin|follow\s*back|f4f|sub4sub|click\s*here|dm\s*me)\b|🔞)/i;
const PROMO_HANDLE_RE = /(?:spam|promo|airdrop|giveaway|adult|xxx|casino|signals?)\d*(?:\.|$)/i;

function labels(profile = {}) {
    return (Array.isArray(profile.labels) ? profile.labels : [])
        .map(label => String(label?.val || label?.value || '').toLowerCase())
        .filter(Boolean);
}

export function assessSocialAccount(profile = {}, { warm = false } = {}) {
    const handle = String(profile.handle || '').trim().toLowerCase();
    const displayName = String(profile.displayName || '').trim();
    const description = String(profile.description || '').trim();
    const combined = `${handle} ${displayName} ${description}`;
    const labelValues = labels(profile);
    const reasons = [];
    const warnings = [];

    if (!handle || !String(profile.did || '').startsWith('did:')) reasons.push('invalid_identity');
    if (ADULT_OR_SCAM_RE.test(combined)) reasons.push('adult_or_scam_signal');
    if (PROMO_HANDLE_RE.test(handle)) reasons.push('promotional_handle');
    const blockedLabels = labelValues.filter(label => BLOCK_LABELS.has(label));
    if (blockedLabels.length) reasons.push(`moderation_label:${blockedLabels.join('|')}`);
    if (labelValues.includes('bot')) warnings.push('automated_account');

    const followers = Math.max(0, Number(profile.followersCount || 0));
    const follows = Math.max(0, Number(profile.followsCount || 0));
    const posts = Math.max(0, Number(profile.postsCount || 0));
    if (follows >= 1000 && followers < 50) reasons.push('mass_following_low_trust');
    else if (follows >= 400 && follows > Math.max(1, followers) * 40) reasons.push('extreme_follow_ratio');
    if (!description && !profile.avatar && follows > 200) warnings.push('empty_high_activity_profile');

    let qualityScore = 0;
    if (warm) qualityScore += 4;
    if (!handle.endsWith('.bsky.social')) qualityScore += 2;
    if (description.length >= 40) qualityScore += 1;
    if (profile.avatar) qualityScore += 1;
    if (posts >= 10) qualityScore += 1;
    if (followers >= 10) qualityScore += 1;
    if (warnings.includes('automated_account')) qualityScore -= 2;
    if (warnings.includes('empty_high_activity_profile')) qualityScore -= 1;

    const blocked = reasons.length > 0;
    const trustedEnough = warm || qualityScore >= 3;
    return {
        ok: !blocked && trustedEnough,
        blocked,
        trustedEnough,
        qualityScore,
        reasons,
        warnings,
        labels: labelValues,
    };
}

export default assessSocialAccount;
