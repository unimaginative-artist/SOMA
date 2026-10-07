import { createHash } from 'node:crypto';
import { twitchName, publicTwitchText } from './TwitchSafety.js';

export function twitchEvent(type, channel, fields, now = Date.now()) {
    channel = twitchName(channel);
    if (!['raid', 'cheer', 'poll'].includes(type)) throw new Error('Unknown Twitch event');
    if (type === 'poll') {
        if (fields.status !== 'COMPLETED' || typeof fields.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(fields.id)) return null;
        const ended = Date.parse(fields.ended_at);
        if (!Number.isFinite(ended) || now - ended > 120000 || ended > now + 5000) return null;
        const title = publicTwitchText(fields.title);
        if (!title || !Array.isArray(fields.choices) || fields.choices.length < 2 || fields.choices.length > 5) return null;
        const choices = fields.choices.map(c => ({ title: publicTwitchText(c.title), votes: c.votes }));
        if (choices.some(c => !c.title || !Number.isSafeInteger(c.votes) || c.votes < 0)) return null;
        const votes = Math.max(...choices.map(c => c.votes));
        const winners = choices.filter(c => c.votes === votes).map(c => c.title.slice(0, 60));
        return { type, channel, id: `poll:${fields.id}`, reply: votes === 0
            ? `Poll ended: ${title.slice(0, 100)}. No votes were recorded.`
            : `Poll result: ${winners.join(' / ')} ${winners.length > 1 ? 'tied' : 'won'} with ${votes} votes. (${title.slice(0, 90)})` };
    }
    const username = twitchName(fields.username);
    const count = Number(fields.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 100000000) return null;
    const timestamp = Number(fields.timestamp);
    if (Number.isFinite(timestamp) && (now - timestamp > 120000 || timestamp > now + 5000)) return null;
    const identity = fields.id || `${username}:${count}:${Math.floor((timestamp || now) / 60000)}`;
    const id = `${type}:${createHash('sha256').update(`${channel}:${identity}`).digest('hex')}`;
    return { type, channel, id, reply: type === 'raid'
        ? `Welcome @${username} and the ${count} raiders! Make yourselves at home.`
        : `Thank you @${username} for cheering ${count} Bits!` };
}
