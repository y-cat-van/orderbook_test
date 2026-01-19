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

    // 2. 不同币种在不同时间段的胜率 (按小时)
    console.log("\n=== 2. 币种 & 时间段 (小时) 胜率 ===");
    const assetTimeStats = {};
    allData.forEach(d => {
        const hour = new Date(d.buy_time.replace(/\//g, '-')).getHours();
        if (isNaN(hour)) return;
        const key = `${d.asset}_${hour}`;
        if (!assetTimeStats[key]) assetTimeStats[key] = { tp: 0, sl: 0, total: 0 };
        assetTimeStats[key].total++;
        if (d.status === 'TAKE_PROFIT') assetTimeStats[key].tp++;
        else if (d.status === 'STOP_LOSS') assetTimeStats[key].sl++;
    });

    const sortedTimeKeys = Object.keys(assetTimeStats).sort((a, b) => {
        const [assetA, hourA] = a.split('_');
        const [assetB, hourB] = b.split('_');
        if (assetA !== assetB) return assetA.localeCompare(assetB);
        return parseInt(hourA) - parseInt(hourB);
    });

    sortedTimeKeys.forEach(key => {
        const s = assetTimeStats[key];
        const [asset, hour] = key.split('_');
        const wr = (s.tp / (s.tp + s.sl) * 100 || 0).toFixed(2);
        console.log(`${asset.padEnd(5)} | 时间: ${hour.padStart(2, '0')}:00 | 交易: ${s.total.toString().padEnd(4)} | 胜率: ${wr}%`);
    });

    // 3. 不同币种在不同anchor_price区间的胜率
    console.log("\n=== 3. 币种 & 价格区间 (anchor_price) 胜率 ===");
    const priceBins = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const assetPriceStats = {};

    allData.forEach(d => {
        const price = parseFloat(d.anchor_price);
        if (isNaN(price)) return;
        
        let binLabel = "";
        for (let i = 0; i < priceBins.length - 1; i++) {
            if (price >= priceBins[i] && price < priceBins[i+1]) {
                binLabel = `${priceBins[i].toFixed(1)}-${priceBins[i+1].toFixed(1)}`;
                break;
            }
        }
        if (!binLabel) return;

        const key = `${d.asset}_${binLabel}`;
        if (!assetPriceStats[key]) assetPriceStats[key] = { tp: 0, sl: 0, total: 0 };
        assetPriceStats[key].total++;
        if (d.status === 'TAKE_PROFIT') assetPriceStats[key].tp++;
        else if (d.status === 'STOP_LOSS') assetPriceStats[key].sl++;
    });

    const sortedPriceKeys = Object.keys(assetPriceStats).sort();
    sortedPriceKeys.forEach(key => {
        const s = assetPriceStats[key];
        const [asset, bin] = key.split('_');
        const wr = (s.tp / (s.tp + s.sl) * 100 || 0).toFixed(2);
        console.log(`${asset.padEnd(5)} | 区间: ${bin.padEnd(8)} | 交易: ${s.total.toString().padEnd(4)} | 胜率: ${wr}%`);
    });

    // 4. 不同币种在市场开始后的不同时间点买入（第xx分钟）的胜率
    console.log("\n=== 4. 币种 & 窗口内买入时间 (分钟) 胜率 ===");
    const assetMinuteStats = {};
    allData.forEach(d => {
        if (!d.window_start || !d.buy_time) return;
        const winStart = new Date(d.window_start.replace(/\//g, '-')).getTime();
        const buyTime = new Date(d.buy_time.replace(/\//g, '-')).getTime();
        
        if (isNaN(winStart) || isNaN(buyTime)) return;

        // 计算买入时间距离窗口开始的分钟数
        const diffMinutes = Math.floor((buyTime - winStart) / (1000 * 60));
        
        // 我们只关注 0-60 分钟内的交易（涵盖 15m 和 1h 窗口）
        if (diffMinutes < 0 || diffMinutes >= 60) return;

        const key = `${d.asset}_${diffMinutes}`;
        if (!assetMinuteStats[key]) assetMinuteStats[key] = { tp: 0, sl: 0, total: 0 };
        assetMinuteStats[key].total++;
        if (d.status === 'TAKE_PROFIT') assetMinuteStats[key].tp++;
        else if (d.status === 'STOP_LOSS') assetMinuteStats[key].sl++;
    });

    const sortedMinuteKeys = Object.keys(assetMinuteStats).sort((a, b) => {
        const [assetA, minA] = a.split('_');
        const [assetB, minB] = b.split('_');
        if (assetA !== assetB) return assetA.localeCompare(assetB);
        return parseInt(minA) - parseInt(minB);
    });

    let currentAsset = "";
    sortedMinuteKeys.forEach(key => {
        const s = assetMinuteStats[key];
        const [asset, min] = key.split('_');
        if (asset !== currentAsset) {
            console.log(`--- ${asset} ---`);
            currentAsset = asset;
        }
        const wr = (s.tp / (s.tp + s.sl) * 100 || 0).toFixed(2);
        console.log(`第 ${min.padStart(2, ' ')} 分钟 | 交易: ${s.total.toString().padEnd(4)} | 胜率: ${wr}%`);
    });

    // 建议逻辑保持不变...
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
