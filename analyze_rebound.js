import fs from 'fs';
import path from 'path';

function parseCSV(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    
    return lines.slice(1).map(line => {
        // Handle potential commas inside quotes
        const values = line.match(/(".*?"|[^,]+)/g).map(v => v.replace(/"/g, ''));
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = values[i];
        });
        return obj;
    });
}

function analyze() {
    const files = ['strategy_analysis.csv', 'rebound.csv'];
    let allData = [];
    
    files.forEach(file => {
        allData = allData.concat(parseCSV(path.join(process.cwd(), file)));
    });

    if (allData.length === 0) {
        console.log("No data found.");
        return;
    }

    // Filter out rows with missing essential data
    allData = allData.filter(d => d.buy_price && d.sell_price && d.status);

    const stats = {
        total: allData.length,
        tp: 0,
        sl: 0,
        force: 0,
        assets: {},
        directions: {
            'Up': { tp: 0, sl: 0, total: 0 },
            'Down': { tp: 0, sl: 0, total: 0 }
        },
        drops: [],
        holdTimes: [],
        flashTimes: [],
        configs: new Set()
    };

    allData.forEach(d => {
        const buyPrice = parseFloat(d.buy_price);
        const sellPrice = parseFloat(d.sell_price);
        const anchorPrice = parseFloat(d.anchor_price);
        const drop = anchorPrice - buyPrice;
        
        // Track unique configs
        if (d.drop_threshold) {
            stats.configs.add(`${d.flash_window}/${d.drop_threshold}/${d.tp_distance}/${d.sl_distance}`);
        }
        
        // Status counts
        if (d.status === 'TAKE_PROFIT') stats.tp++;
        else if (d.status === 'STOP_LOSS') stats.sl++;
        else if (d.status === 'FORCE_CLEAR') stats.force++;

        // Asset stats
        if (!stats.assets[d.asset]) {
            stats.assets[d.asset] = { tp: 0, sl: 0, force: 0, total: 0, totalDrop: 0 };
        }
        stats.assets[d.asset].total++;
        stats.assets[d.asset].totalDrop += drop;
        if (d.status === 'TAKE_PROFIT') stats.assets[d.asset].tp++;
        else if (d.status === 'STOP_LOSS') stats.assets[d.asset].sl++;
        else if (d.status === 'FORCE_CLEAR') stats.assets[d.asset].force++;

        // Direction stats
        if (stats.directions[d.direction]) {
            stats.directions[d.direction].total++;
            if (d.status === 'TAKE_PROFIT') stats.directions[d.direction].tp++;
            else if (d.status === 'STOP_LOSS') stats.directions[d.direction].sl++;
        }

        stats.drops.push(drop);

        // Time analysis
        const anchorTime = new Date(d.anchor_time.replace(/\//g, '-')).getTime();
        const buyTime = new Date(d.buy_time.replace(/\//g, '-')).getTime();
        const sellTime = new Date(d.sell_time.replace(/\//g, '-')).getTime();
        
        if (!isNaN(anchorTime) && !isNaN(buyTime)) {
            stats.flashTimes.push((buyTime - anchorTime) / 1000);
        }
        if (!isNaN(buyTime) && !isNaN(sellTime)) {
            stats.holdTimes.push((sellTime - buyTime) / 1000);
        }
    });

    console.log("=== Global Statistics ===");
    console.log(`Total Trades: ${stats.total}`);
    if (stats.configs.size > 0) {
        console.log(`Parameters Used (win/drop/tp/sl): ${Array.from(stats.configs).join(' | ')}`);
    }
    console.log(`Take Profit: ${stats.tp}`);
    console.log(`Stop Loss: ${stats.sl}`);
    console.log(`Force Clear: ${stats.force}`);
    const winRate = (stats.tp / (stats.tp + stats.sl) * 100).toFixed(2);
    console.log(`Win Rate (TP/TP+SL): ${winRate}%`);
    
    const avgDrop = (stats.drops.reduce((a, b) => a + b, 0) / stats.drops.length).toFixed(4);
    console.log(`Average Flash Drop: ${avgDrop}`);
    
    const avgFlash = (stats.flashTimes.reduce((a, b) => a + b, 0) / stats.flashTimes.length).toFixed(2);
    console.log(`Average Flash Duration: ${avgFlash}s`);
    
    const avgHold = (stats.holdTimes.reduce((a, b) => a + b, 0) / stats.holdTimes.length).toFixed(2);
    console.log(`Average Hold Duration: ${avgHold}s`);

    console.log("\n=== Statistics by Asset ===");
    Object.keys(stats.assets).forEach(asset => {
        const a = stats.assets[asset];
        const wr = (a.tp / (a.tp + a.sl) * 100 || 0).toFixed(2);
        const ad = (a.totalDrop / a.total).toFixed(4);
        console.log(`${asset.padEnd(10)} | Trades: ${a.total.toString().padEnd(4)} | WinRate: ${wr}% | AvgDrop: ${ad}`);
    });

    console.log("\n=== Statistics by Direction ===");
    Object.keys(stats.directions).forEach(dir => {
        const d = stats.directions[dir];
        const wr = (d.tp / (d.tp + d.sl) * 100 || 0).toFixed(2);
        console.log(`${dir.padEnd(10)} | Trades: ${d.total.toString().padEnd(4)} | WinRate: ${wr}%`);
    });

    // Simple parameter suggestion
    console.log("\n=== Parameter Suggestions ===");
    if (parseFloat(winRate) < 50) {
        console.log("- 建议：增加 'drop' 阈值（当前平均下跌 " + avgDrop + "）。目前的买入点可能多为市场波动而非真正的闪崩。");
        console.log("- 建议：缩紧 'sl' (止损) 距离，或者在胜率低时考虑减少交易频率。");
    } else if (parseFloat(winRate) > 70) {
        console.log("- 建议：当前策略非常稳定。可以尝试稍微降低 'drop' 以捕捉更多机会，或者扩大 'tp' (止盈) 以获得更高利润。");
    } else {
        console.log("- 建议：目前的 0.05/0.05 比例表现均衡。可以尝试观察不同币种的 AvgDrop，针对性调整。");
    }
}

analyze();
