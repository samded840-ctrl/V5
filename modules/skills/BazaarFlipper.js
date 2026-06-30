import { ModuleBase } from '../../utils/ModuleBase';
import { MacroState } from '../../utils/MacroState';
import { ScheduleTask } from '../../utils/ScheduleTask';

const BAZAAR_API_URL = 'https://api.hypixel.net/skyblock/bazaar?key=YOUR_API_KEY_HERE';
const MIN_PROFIT_MARGIN = 0.05;
const MIN_VOLUME = 1000;
const MAX_LISTINGS_TO_BUY = 71680;
const SCAN_INTERVALS = { FAST: 1000, NORMAL: 5000, SLOW: 30000 };

class BazaarFlipper extends ModuleBase {
    constructor() {
        super({
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
        
        this.on('tick', function() {
            this.runLoop(this.loopToken);
        }.bind(this));

        this.addToggle('Auto Execute Flips', function(value) {
            this.autoExecuteEnabled = value;
            this.message(value ? '&aAuto-execute enabled' : '&cAuto-execute disabled');
        }, 'Automatically buy and sell flips.', false);

        this.addSlider('Max Spend Per Flip', 1000, 1000000000, 100000, 1000, function(value) {
            this.maxSpendPerFlip = Number(value);
        }, 'Maximum coins to spend per flip.');

        this.addSlider('Min Profit Margin %', 1, 100, 5, 1, function(value) {
            this.minProfitMargin = Number(value) / 100;
        }, 'Minimum profit percentage required.');

        this.addSlider('Min Daily Volume', 100, 1000000, 1000, 100, function(value) {
            this.minVolume = Number(value);
        }, 'Minimum daily trading volume.');

        this.createOverlay([
            {
                title: 'Bazaar Flipper',
                data: {
                    Status: function() { return this.status; }.bind(this),
                    'Current Purse': function() { return this.formatCoins(this.currentPurse); }.bind(this),
                    Opportunities: function() { return this.flipOpportunities.length; }.bind(this),
                    'Potential Profit': function() { return this.formatCoins(this.totalProfitPotential); }.bind(this),
                    'Last Scan': function() { return this.getTimeSinceLastScan(); }.bind(this),
                },
            },
            {
                title: 'Top Flips',
                data: function() { return this.getTopFlipsDisplay(); }.bind(this),
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

    runLoop(token) {
        if (!this.enabled || token !== this.loopToken) return;

        var currentTime = Date.now();
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
            this.performScan();
            this.lastScanTime = currentTime;
        }

        if (this.autoExecuteEnabled && this.flipOpportunities.length > 0) {
            this.status = 'Executing Flips';
            this.executeFlips();
        } else if (this.flipOpportunities.length > 0) {
            this.status = 'Found ' + this.flipOpportunities.length + ' Opportunities';
        } else {
            this.status = 'No Profitable Flips';
        }
    }

    performScan() {
        var self = this;
        this.fetchBazaarData().then(function(response) {
            if (!response || !response.success) {
                self.status = 'API Error';
                return;
            }
            self.bazaarData = response.products;
            self.analyzeFlips();
        }).catch(function(error) {
            self.status = 'Scan Failed';
        });
    }

    fetchBazaarData() {
        return fetch(BAZAAR_API_URL).then(function(response) {
            return response.json();
        }).catch(function(error) {
            return null;
        });
    }

    analyzeFlips() {
        if (!this.bazaarData) return;

        var opportunities = [];
        var totalProfit = 0;
        var purse = this.currentPurse;

        for (var itemId in this.bazaarData) {
            var itemData = this.bazaarData[itemId];
            if (!itemData.quick_status) continue;

            var buyPrice = itemData.quick_status.buyPrice;
            var sellPrice = itemData.quick_status.sellPrice;
            var buyVolume = itemData.quick_status.buyVolume;
            var sellVolume = itemData.quick_status.sellVolume;

            if (buyVolume < this.minVolume || sellVolume < this.minVolume) continue;
            if (buyPrice <= 0 || sellPrice <= 0) continue;

            var profitMargin = (sellPrice - buyPrice) / buyPrice;
            
            if (profitMargin >= this.minProfitMargin) {
                var maxAffordable = Math.floor(purse / buyPrice);
                var maxByVolume = Math.min(buyVolume, sellVolume);
                var maxBuyable = Math.min(maxAffordable, maxByVolume, MAX_LISTINGS_TO_BUY);
                var maxBySpendLimit = Math.floor(this.maxSpendPerFlip / buyPrice);
                var quantity = Math.min(maxBuyable, maxBySpendLimit);
                
                if (quantity <= 0) continue;

                var totalCost = quantity * buyPrice;
                var totalRevenue = quantity * sellPrice;
                var profit = totalRevenue - totalCost;
                var roi = (profit / totalCost) * 100;

                opportunities.push({
                    itemId: itemId,
                    itemName: this.formatItemName(itemId),
                    buyPrice: buyPrice,
                    sellPrice: sellPrice,
                    profitMargin: profitMargin * 100,
                    quantity: quantity,
                    totalCost: totalCost,
                    totalRevenue: totalRevenue,
                    profit: profit,
                    roi: roi,
                    buyVolume: buyVolume,
                    sellVolume: sellVolume,
                });
            }
        }

        opportunities.sort(function(a, b) { return b.profit - a.profit; });
        this.flipOpportunities = opportunities;
        this.totalProfitPotential = opportunities.reduce(function(sum, flip) { return sum + flip.profit; }, 0);
    }

    executeFlips() {
        if (!this.autoExecuteEnabled || this.flipOpportunities.length === 0) return;

        var bestFlip = this.flipOpportunities[0];
        if (this.currentPurse < bestFlip.totalCost) {
            this.flipOpportunities = [];
            this.totalProfitPotential = 0;
            return;
        }

        this.message('&6Executing flip: &f' + bestFlip.itemName + ' &7x' + bestFlip.quantity + ' &8| &6Profit: &a' + this.formatCoins(bestFlip.profit));
        this.placeBuyOrder(bestFlip);
        this.placeSellOrder(bestFlip);
        this.flipOpportunities.shift();
        this.performScan();
    }

    placeBuyOrder(flip) {
        this.message('&7Placing buy order for ' + flip.quantity + 'x ' + flip.itemName + ' at ' + this.formatCoins(flip.buyPrice) + ' each');
    }

    placeSellOrder(flip) {
        this.message('&7Placing sell order for ' + flip.quantity + 'x ' + flip.itemName + ' at ' + this.formatCoins(flip.sellPrice) + ' each');
    }

    updatePurse() {
        var self = this;
        var lines = Scoreboard.getLines();
        if (!lines) return;
        
        lines.forEach(function(line) {
            var text = ChatLib.removeFormatting(line.getName());
            if (text.indexOf('Purse:') !== -1 || text.indexOf('Piggy:') !== -1) {
                var coins = text.replace(/[^0-9]/g, '');
                self.currentPurse = parseInt(coins) || 0;
            }
        });
    }

    getTopFlipsDisplay() {
        var topFlips = this.flipOpportunities.slice(0, 5);
        var display = {};
        var self = this;
        
        topFlips.forEach(function(flip, index) {
            display[(index + 1) + '. ' + flip.itemName] = 
                'Profit: ' + self.formatCoins(flip.profit) + ' (' + flip.roi.toFixed(1) + '% ROI)';
        });

        if (Object.keys(display).length === 0) {
            display['No Flips'] = 'Waiting for opportunities...';
        }

        return display;
    }

    formatItemName(itemId) {
        return itemId
            .replace(/_/g, ' ')
            .replace(/\b\w/g, function(char) { return char.toUpperCase(); })
            .replace('Enchanted', 'Ench.')
            .trim();
    }

    formatCoins(coins) {
        if (coins >= 1000000) return (coins / 1000000).toFixed(1) + 'M';
        if (coins >= 1000) return (coins / 1000).toFixed(1) + 'K';
        return coins.toString();
    }

    getTimeSinceLastScan() {
        if (this.lastScanTime === 0) return 'Never';
        var seconds = Math.floor((Date.now() - this.lastScanTime) / 1000);
        return seconds + 's ago';
    }
}

new BazaarFlipper();
