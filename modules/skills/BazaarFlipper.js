// V5 Bazaar Flipper
// Scans bazaar for profitable flips based on available purse
import { ModuleBase } from '../../utils/ModuleBase';
import { MacroState } from '../../utils/MacroState';
import { ScheduleTask } from '../../utils/ScheduleTask';

ChatLib.chat('&a[V5] BazaarFlipper.js file is being loaded...');

const BAZAAR_API_URL = 'https://api.hypixel.net/skyblock/bazaar';
const MIN_PROFIT_MARGIN = 0.05;
const MIN_VOLUME = 1000;
const MAX_LISTINGS_TO_BUY = 71680;
const SCAN_INTERVALS = {
    FAST: 1000,
    NORMAL: 5000,
    SLOW: 30000
};

class BazaarFlipper extends ModuleBase {
    constructor() {
        super({
            ChatLib.chat('&a[V5] BazaarFlipper constructor running!');
            name: 'Bazaar Flipper',
            subcategory: 'Skills',
            description: 'Scans the Bazaar for profitable flips based on your current purse.',
            tooltip: 'Automatically finds buy/sell opportunities and can execute trades.',
            theme: '#FFD700',
            showEnabledToggle: false,
            isMacro: true,
        });

        this.bindToggleKey();
        
        this.status = 'Idle';
        this.loopToken = 0;
        this.scanInterval = SCAN_INTERVALS.NORMAL;
        this.lastScanTime = 0;
        this.bazaarData = null;
        this.flipOpportunities = [];
        this.totalProfitPotential = 0;
        this.autoExecuteEnabled = false;
        this.maxSpendPerFlip = 100000;
        this.minProfitMargin = MIN_PROFIT_MARGIN;
        this.minVolume = MIN_VOLUME;
        this.currentPurse = 0;
        
        this.on('tick', () => this.runLoop(this.loopToken));

        this.addToggle('Auto Execute Flips', false, (enabled) => {
            this.autoExecuteEnabled = enabled;
            this.message(enabled ? '&aAuto-execute enabled' : '&cAuto-execute disabled');
        });

        this.addNumberSetting('Max Spend Per Flip', 100000, 1000, 1000000000, 1000, (value) => {
            this.maxSpendPerFlip = value;
        });

        this.addNumberSetting('Min Profit Margin %', 5, 1, 100, 1, (value) => {
            this.minProfitMargin = value / 100;
        });

        this.addNumberSetting('Min Daily Volume', 1000, 100, 1000000, 100, (value) => {
            this.minVolume = value;
        });

        this.createOverlay([
            {
                title: 'Bazaar Flipper',
                data: {
                    Status: () => this.status,
                    'Current Purse': () => this.formatCoins(this.currentPurse),
                    Opportunities: () => this.flipOpportunities.length,
                    'Potential Profit': () => this.formatCoins(this.totalProfitPotential),
                    'Last Scan': () => this.getTimeSinceLastScan(),
                },
            },
            {
                title: 'Top Flips',
                data: () => this.getTopFlipsDisplay(),
            },
        ]);
    }

    onEnable() {
        this.loopToken++;
        this.status = 'Starting';
        this.flipOpportunities = [];
        this.totalProfitPotential = 0;
        this.message('&aBazaar Flipper enabled');
        this.updatePurse();
        this.performScan();
    }

    onDisable() {
        this.loopToken++;
        this.status = 'Disabled';
        this.message('&cBazaar Flipper disabled');
    }

    async runLoop(token) {
        if (!this.enabled || token !== this.loopToken) return;

        const currentTime = Date.now();
        this.updatePurse();

        if (this.flipOpportunities.length > 0 && this.autoExecuteEnabled) {
            this.scanInterval = SCAN_INTERVALS.FAST;
        } else if (this.flipOpportunities.length > 0) {
            this.scanInterval = SCAN_INTERVALS.NORMAL;
        } else {
            this.scanInterval = SCAN_INTERVALS.SLOW;
        }

        if (currentTime - this.lastScanTime >= this.scanInterval) {
            this.status = 'Scanning Bazaar...';
            await this.performScan();
            this.lastScanTime = currentTime;
        }

        if (this.autoExecuteEnabled && this.flipOpportunities.length > 0) {
            this.status = 'Executing Flips';
            await this.executeFlips();
        } else if (this.flipOpportunities.length > 0) {
            this.status = `Found ${this.flipOpportunities.length} Opportunities`;
        } else {
            this.status = 'No Profitable Flips';
        }
    }

    async performScan() {
        try {
            const response = await this.fetchBazaarData();
            if (!response || !response.success) {
                this.status = 'API Error';
                return;
            }

            this.bazaarData = response.products;
            this.analyzeFlips();

        } catch (error) {
            this.status = 'Scan Failed';
        }
    }

    async fetchBazaarData() {
        try {
            const response = await fetch(BAZAAR_API_URL);
            return await response.json();
        } catch (error) {
            return null;
        }
    }

    analyzeFlips() {
        if (!this.bazaarData) return;

        const opportunities = [];
        let totalProfit = 0;
        const purse = this.currentPurse;

        for (const [itemId, itemData] of Object.entries(this.bazaarData)) {
            if (!itemData.quick_status) continue;

            const buyPrice = itemData.quick_status.buyPrice;
            const sellPrice = itemData.quick_status.sellPrice;
            const buyVolume = itemData.quick_status.buyVolume;
            const sellVolume = itemData.quick_status.sellVolume;

            if (buyVolume < this.minVolume || sellVolume < this.minVolume) continue;
            if (buyPrice <= 0 || sellPrice <= 0) continue;

            const profitMargin = (sellPrice - buyPrice) / buyPrice;
            
            if (profitMargin >= this.minProfitMargin) {
                const maxAffordable = Math.floor(purse / buyPrice);
                const maxByVolume = Math.min(buyVolume, sellVolume);
                const maxBuyable = Math.min(maxAffordable, maxByVolume, MAX_LISTINGS_TO_BUY);
                const maxBySpendLimit = Math.floor(this.maxSpendPerFlip / buyPrice);
                const quantity = Math.min(maxBuyable, maxBySpendLimit);
                
                if (quantity <= 0) continue;

                const totalCost = quantity * buyPrice;
                const totalRevenue = quantity * sellPrice;
                const profit = totalRevenue - totalCost;
                const roi = (profit / totalCost) * 100;

                opportunities.push({
                    itemId,
                    itemName: this.formatItemName(itemId),
                    buyPrice,
                    sellPrice,
                    profitMargin: profitMargin * 100,
                    quantity,
                    totalCost,
                    totalRevenue,
                    profit,
                    roi,
                    buyVolume,
                    sellVolume,
                });
            }
        }

        opportunities.sort((a, b) => b.profit - a.profit);
        
        this.flipOpportunities = opportunities;
        this.totalProfitPotential = opportunities.reduce((sum, flip) => sum + flip.profit, 0);
    }

    async executeFlips() {
        if (!this.autoExecuteEnabled || this.flipOpportunities.length === 0) return;

        const bestFlip = this.flipOpportunities[0];
        
        if (this.currentPurse < bestFlip.totalCost) {
            this.flipOpportunities = [];
            this.totalProfitPotential = 0;
            return;
        }

        this.message(`&6Executing flip: &f${bestFlip.itemName} &7x${bestFlip.quantity} &8| &6Profit: &a${this.formatCoins(bestFlip.profit)}`);
        
        await this.placeBuyOrder(bestFlip);
        await this.placeSellOrder(bestFlip);
        
        this.flipOpportunities.shift();
        await this.performScan();
    }

    async placeBuyOrder(flip) {
        this.message(`&7Placing buy order for ${flip.quantity}x ${flip.itemName} at ${this.formatCoins(flip.buyPrice)} each`);
    }

    async placeSellOrder(flip) {
        this.message(`&7Placing sell order for ${flip.quantity}x ${flip.itemName} at ${this.formatCoins(flip.sellPrice)} each`);
    }

    updatePurse() {
        const player = Player.getPlayer();
        if (player) {
            this.currentPurse = player.getPurse() || 0;
        }
    }

    getTopFlipsDisplay() {
        const topFlips = this.flipOpportunities.slice(0, 5);
        const display = {};
        
        topFlips.forEach((flip, index) => {
            display[`${index + 1}. ${flip.itemName}`] = 
                `Profit: ${this.formatCoins(flip.profit)} (${flip.roi.toFixed(1)}% ROI)`;
        });

        if (Object.keys(display).length === 0) {
            display['No Flips'] = 'Waiting for opportunities...';
        }

        return display;
    }

    formatItemName(itemId) {
        return itemId
            .replace(/_/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase())
            .replace('Enchanted', 'Ench.')
            .trim();
    }

    formatCoins(coins) {
        if (coins >= 1000000) return `${(coins / 1000000).toFixed(1)}M`;
        if (coins >= 1000) return `${(coins / 1000).toFixed(1)}K`;
        return coins.toString();
    }

    getTimeSinceLastScan() {
        if (this.lastScanTime === 0) return 'Never';
        const seconds = Math.floor((Date.now() - this.lastScanTime) / 1000);
        return `${seconds}s ago`;
    }
}

new BazaarFlipper();
