
import fs from 'fs';
import path from 'path';

function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];

    const header = lines[0].split(',');
    const statusIdx = header.indexOf('status');
    const assetIdx = header.indexOf('asset');
    const buyTimeIdx = header.indexOf('buy_time');

    if (statusIdx === -1 || assetIdx === -1 || buyTimeIdx === -1) {
        // Try fallback to column indices if header is weird
        return lines.slice(1).map(line => {
            const parts = line.split(',').map(p => p.replace(/"/g, ''));
            // Assuming common structure: 0: window, 1: asset, 2: dir ... 9/12: status
            return {
                asset: parts[1],
                status: parts[parts.length - 5] || parts[9], // Heuristic for status
                buyTime: new Date(parts[3] || parts[5]).getTime()
            };
        });
    }

    return lines.slice(1).map(line => {
        const parts = line.split(',').map(p => p.replace(/"/g, ''));
        return {
            asset: parts[assetIdx],
            status: parts[statusIdx],
            buyTime: new Date(parts[buyTimeIdx]).getTime()
        };
    }).filter(t => t.asset && t.status);
}

function analyze() {
    const files = fs.readdirSync(process.cwd()).filter(f => f.startsWith('rebound') && f.endsWith('.csv'));
    let allTrades = [];

    files.forEach(f => {
        allTrades = allTrades.concat(parseCSV(path.join(process.cwd(), f)));
    });

    // Sort by buy time
    allTrades.sort((a, b) => a.buyTime - b.buyTime);

    const assetGroups = {};
    allTrades.forEach(t => {
        if (!assetGroups[t.asset]) assetGroups[t.asset] = [];
        assetGroups[t.asset].push(t);
    });

    console.log('--- 策略分析报告: 止损后的表现 ---');

    Object.entries(assetGroups).forEach(([asset, trades]) => {
        let totalWins = 0;
        let totalLosses = 0;
        let winsAfterSL = 0;
        let lossesAfterSL = 0;
        let nextTradeAfterSLCount = 0;

        for (let i = 0; i < trades.length; i++) {
            const current = trades[i];
            if (current.status === 'TAKE_PROFIT') totalWins++;
            if (current.status === 'STOP_LOSS') {
                totalLosses++;
                
                // 寻找同一个币种的下一笔交易
                const next = trades[i + 1];
                if (next) {
                    // 如果下一笔交易在 1 小时内发生，视为“连续交易”
                    const timeGap = (next.buyTime - current.buyTime) / (1000 * 60);
                    if (timeGap < 60) {
                        nextTradeAfterSLCount++;
                        if (next.status === 'TAKE_PROFIT') winsAfterSL++;
                        if (next.status === 'STOP_LOSS') lossesAfterSL++;
                    }
                }
            }
        }

        const overallWinRate = (totalWins / (totalWins + totalLosses) * 100).toFixed(2);
        const afterSLWinRate = nextTradeAfterSLCount > 0 
            ? (winsAfterSL / (winsAfterSL + lossesAfterSL) * 100).toFixed(2)
            : 'N/A';

        console.log(`\n资产: ${asset}`);
        console.log(`  总交易数: ${trades.length}`);
        console.log(`  总胜率: ${overallWinRate}% (${totalWins}胜 / ${totalLosses}负)`);
        console.log(`  止损后(1小时内)下一笔胜率: ${afterSLWinRate}% (${winsAfterSL}胜 / ${lossesAfterSL}负)`);
        
        if (nextTradeAfterSLCount > 0) {
            const diff = parseFloat(afterSLWinRate) - parseFloat(overallWinRate);
            if (diff < -5) {
                console.log(`  建议: [暂停交易] - 止损后胜率显著下降 ${Math.abs(diff).toFixed(2)}%，可能存在连环杀。`);
            } else if (diff > 5) {
                console.log(`  建议: [继续交易] - 止损后胜率反而提升，可能是二次探底回升机会。`);
            } else {
                console.log(`  建议: [维持现状] - 止损对下一笔胜率影响不明显。`);
            }
        } else {
            console.log(`  建议: [数据不足] - 止损后连续交易样本太少。`);
        }
    });
}

analyze();
