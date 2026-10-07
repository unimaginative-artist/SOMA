import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';

async function main() {
  const arbiter = new DiscordArbiter({});
  await arbiter.onInitialize();
  const summaryMessage = [
    '🐝 **SOMA Trading Intelligence Briefing: BeeBots + Laya System 1**',
    'Hey Owner, here is the breakdown of what I found and the plan while you are headed to work:\n',
    '1️⃣ **The Discovery**: The BeeBots repo you sent uses TypeSafe AI\'s "Jev" model. Jev is the commercial cloud version of the **exact same RLCD System 1 architecture** as our local **Laya** model running on your RTX 5070.',
    '2️⃣ **The Edge ($0 Cost & Sub-35ms Decisions)**: Instead of paying cloud token fees or hitting $2/day caps, SOMA can evaluate market setups every 10 seconds locally on your GPU in ~25ms at zero cost.',
    '3️⃣ **The 3 Trading Bees**: We will port the 3 core strategies:',
    '   • `bizzy-bee`: Larry Williams daily volatility breakout (BTC, ETH, SOL).',
    '   • `boozy-bee`: Bollinger Bands & RSI fade with a 30-day funding rate veto.',
    '   • `breezy-bee`: Multi-factor ensemble trend-following.',
    '4️⃣ **Zero Risk (Paper Trading)**: We will run this in strict paper trading mode on real OKX perpetual futures market prices with code-enforced hard stop-losses and 1R position sizing.',
    '5️⃣ **Discord Updates**: All trade entries, exits (with realized $ and R-multiples), and hourly P&L digests will report directly here to `#soma-chat`.\n',
    'The full implementation plan is ready in Antigravity for your review. Have a safe shift!'
  ].join('\n');

  const res = await arbiter.sendMessage({
    channelName: 'soma-chat',
    message: summaryMessage
  });
  console.log('Briefing sent successfully:', res.success, res.messageId);
  process.exit(0);
}

main().catch(err => {
  console.error('Error sending Discord briefing:', err);
  process.exit(1);
});
