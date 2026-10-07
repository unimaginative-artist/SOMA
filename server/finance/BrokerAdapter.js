import alpacaService from './AlpacaService.js';
import paperExecutionSimulator from './PaperExecutionSimulator.js';

class BrokerAdapter {
    constructor(name) {
        this.name = name;
    }

    get connected() {
        return false;
    }

    async getAccount() {
        throw new Error(`${this.name} does not implement getAccount()`);
    }

    async submitOrder() {
        throw new Error(`${this.name} does not implement submitOrder()`);
    }
}

class PaperBrokerAdapter extends BrokerAdapter {
    constructor() {
        super('paper');
    }

    get connected() {
        return true;
    }

    async getAccount(portfolio = null) {
        return {
            broker: this.name,
            paper: true,
            equity: portfolio?.balance || 0,
            buyingPower: portfolio?.balance || 0,
            positions: portfolio?.positions || {}
        };
    }

    async submitOrder(order) {
        return paperExecutionSimulator.simulateFill(order);
    }
}

class AlpacaBrokerAdapter extends BrokerAdapter {
    constructor() {
        super('alpaca');
    }

    get connected() {
        return !!alpacaService.isConnected;
    }

    async getAccount() {
        if (!this.connected) throw new Error('Alpaca is not connected');
        return alpacaService.client.getAccount();
    }

    async submitOrder(order) {
        if (!this.connected) throw new Error('Alpaca is not connected');
        return alpacaService.client.createOrder({
            symbol: order.symbol,
            qty: order.qty,
            side: order.side,
            type: order.type || 'market',
            time_in_force: order.timeInForce || 'day'
        });
    }
}

const brokerAdapters = {
    paper: new PaperBrokerAdapter(),
    alpaca: new AlpacaBrokerAdapter()
};

function getBrokerAdapter(mode = 'paper') {
    if (mode === 'alpaca' || mode === 'live') return brokerAdapters.alpaca;
    return brokerAdapters.paper;
}

export { BrokerAdapter, PaperBrokerAdapter, AlpacaBrokerAdapter, brokerAdapters, getBrokerAdapter };
