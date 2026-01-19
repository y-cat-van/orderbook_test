import { parentPort, workerData } from 'worker_threads';
import {
	formatWindowTime,
	formatOccurrenceTime,
	appendStrategyAnalysisToCSV
} from './utils.js';

const { id, config, asset, output } = workerData;
const { flashWindow = 10, dropThreshold = 0.08, tpDistance = 0.05, slDistance = 0.05 } = config || {};

// 策略状态
let priceWindows = {
	'Up': [],
	'Down': []
};

let strategyEvents = {
	'Up': null,
	'Down': null
};

/**
 * 核心策略逻辑 - 实现买入-卖出二段式状态机
 */
function updateStrategy(direction, price, size, winTs, now, isStopBuyPhase, isLiquidationPhase) {
	if (price === null) return;

	const pendingEvent = strategyEvents[direction];
	const timeStr = formatOccurrenceTime(now);

	// --- 状态 B: 探测卖出机会阶段 ---
	if (pendingEvent) {
		const isTakeProfit = price >= pendingEvent.buyPrice + tpDistance;
		const isStopLoss = price <= pendingEvent.buyPrice - slDistance;

		if (isTakeProfit || isStopLoss || isLiquidationPhase) {
			appendStrategyAnalysisToCSV({
				...pendingEvent,
				sellTime: timeStr,
				sellPrice: price,
				sellSize: size,
				status: isLiquidationPhase ? 'FORCE_CLEAR' : (isTakeProfit ? 'TAKE_PROFIT' : 'STOP_LOSS'),
				config: { flashWindow, dropThreshold, tpDistance, slDistance }
			}, output);
			
			strategyEvents[direction] = null;
			
			// 通知主线程交易完成
			parentPort.postMessage({
				type: 'TRADE_COMPLETED',
				payload: { id, asset, direction, status: isLiquidationPhase ? 'FORCE_CLEAR' : (isTakeProfit ? 'TAKE_PROFIT' : 'STOP_LOSS') }
			});
		}
		return;
	}

	// --- 状态 A: 探测买入机会阶段 ---
	if (isStopBuyPhase || isLiquidationPhase) return;

	const window = priceWindows[direction];
	window.push({ price, size, ts: now });
	
	// 清理过期窗口
	while (window.length > 0 && window[0].ts < now - flashWindow * 1000) {
		window.shift();
	}

	if (window.length > 1) {
		// 寻找窗口内的最高价格作为“锚定价格”
		const maxPriceObj = window.reduce((max, p) => p.price > max.price ? p : max, window[0]);
		
		// 检测闪崩
		if (maxPriceObj.price - price >= dropThreshold) {
			strategyEvents[direction] = {
				windowStart: formatWindowTime(winTs),
				asset,
				direction,
				anchorTime: formatOccurrenceTime(maxPriceObj.ts),
				anchorPrice: maxPriceObj.price,
				anchorSize: maxPriceObj.size,
				buyTime: timeStr,
				buyPrice: price,
				buySize: size
			};
			
			// 进入状态 B 后，清除窗口缓存
			priceWindows[direction] = [];

			// 通知主线程进入持仓状态
			parentPort.postMessage({
				type: 'POSITION_OPENED',
				payload: { id, asset, direction, buyPrice: price, anchorPrice: maxPriceObj.price }
			});
		}
	}
}

// 监听来自主线程的行情数据
parentPort.on('message', (message) => {
	if (message.type === 'TICK') {
		const { priceUp, sizeUp, priceDown, sizeDown, winTs, now, isStopBuyPhase, isLiquidationPhase } = message.payload;
		
		updateStrategy('Up', priceUp, sizeUp, winTs, now, isStopBuyPhase, isLiquidationPhase);
		updateStrategy('Down', priceDown, sizeDown, winTs, now, isStopBuyPhase, isLiquidationPhase);
		
		// 定期发送心跳和简要状态
		parentPort.postMessage({
			type: 'HEARTBEAT',
			payload: {
				id,
				hasUpPosition: !!strategyEvents['Up'],
				hasDownPosition: !!strategyEvents['Down']
			}
		});
	}
});
