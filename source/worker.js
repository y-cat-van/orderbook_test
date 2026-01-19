import { parentPort, workerData } from 'worker_threads';
import {
	formatWindowTime,
	formatOccurrenceTime,
	ensureStrategyCSVHeader,
	appendStrategyAnalysisToCSV
} from './utils.js';

const { id, config, asset, output } = workerData;

// 策略类型：rebound (闪崩反弹) 或 pump (暴涨追涨)
const strategyType = config.strategy || 'rebound';

// 初始化 CSV 文件
ensureStrategyCSVHeader(output);
const { 
	window: flashWindow = 10, 
	drop: dropThreshold = 0.08, 
	rise: riseThreshold = 0.05,
	tp: tpDistance = 0.05, 
	sl: slDistance = 0.05 
} = config || {};

// 统一触发阈值
const triggerThreshold = strategyType === 'pump' ? riseThreshold : dropThreshold;

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
				strategy: strategyType,
				sellTime: timeStr,
				sellPrice: price,
				sellSize: size,
				status: isLiquidationPhase ? 'FORCE_CLEAR' : (isTakeProfit ? 'TAKE_PROFIT' : 'STOP_LOSS'),
				config: { flashWindow, triggerThreshold, tpDistance, slDistance }
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
		if (strategyType === 'pump') {
			// --- 暴涨追涨逻辑 ---
			// 寻找窗口内的最低价格作为“锚定价格”
			const minPriceObj = window.reduce((min, p) => p.price < min.price ? p : min, window[0]);
			
			// 检测暴涨
			if (price - minPriceObj.price >= triggerThreshold) {
				strategyEvents[direction] = {
					windowStart: formatWindowTime(winTs),
					asset,
					direction,
					anchorTime: formatOccurrenceTime(minPriceObj.ts),
					anchorPrice: minPriceObj.price,
					anchorSize: minPriceObj.size,
					buyTime: timeStr,
					buyPrice: price,
					buySize: size
				};
				
				// 进入状态 B 后，清除窗口缓存
				priceWindows[direction] = [];

				// 通知主线程进入持仓状态
				parentPort.postMessage({
					type: 'POSITION_OPENED',
					payload: { id, asset, direction, strategy: strategyType, buyPrice: price, anchorPrice: minPriceObj.price }
				});
			}
		} else {
			// --- 闪崩反弹逻辑 (默认) ---
			// 寻找窗口内的最高价格作为“锚定价格”
			const maxPriceObj = window.reduce((max, p) => p.price > max.price ? p : max, window[0]);
			
			// 检测闪崩
			if (maxPriceObj.price - price >= triggerThreshold) {
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
					payload: { id, asset, direction, strategy: strategyType, buyPrice: price, anchorPrice: maxPriceObj.price }
				});
			}
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
