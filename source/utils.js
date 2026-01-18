/**
 * Calculate the Unix timestamp for the current 15-minute window start.
 * Windows are aligned to clock time (e.g., 8:00, 8:15, 8:30, 8:45).
 */
export function getCurrent15MinWindowTimestamp() {
	const now = Math.floor(Date.now() / 1000);
	const windowSeconds = 15 * 60; // 15 minutes
	return Math.floor(now / windowSeconds) * windowSeconds;
}

/**
 * Get the next 15-minute window timestamp
 */
export function getNext15MinWindowTimestamp() {
	return getCurrent15MinWindowTimestamp() + 15 * 60;
}

/**
 * Calculate milliseconds until next window starts
 */
export function getMsUntilNextWindow() {
	const nextWindow = getNext15MinWindowTimestamp();
	return nextWindow * 1000 - Date.now();
}

/**
 * Format timestamp to readable time string
 */
export function formatWindowTime(timestamp) {
	const date = new Date(timestamp * 1000);
	return date.toLocaleString('zh-CN', {
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Asia/Shanghai'
	});
}

/**
 * Format timestamp to readable occurrence time string (YYYY/MM/DD HH:mm:ss) in UTC+8
 */
export function formatOccurrenceTime(timestamp) {
	return new Date(timestamp).toLocaleString('zh-CN', {
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		timeZone: 'Asia/Shanghai'
	});
}

/**
 * Build the market slug for the 15-minute up/down market
 */
export function buildMarketSlug(asset, timestamp) {
	return `${asset.toLowerCase()}-updown-15m-${timestamp}`;
}

/**
 * Fetch market data from Gamma API
 */
export async function fetchMarketData(slug) {
	const tid = Date.now();
	const url = `https://gamma-api.polymarket.com/events/slug/${slug}?tid=${tid}`;

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch market: ${response.status}`);
	}

	return response.json();
}

/**
 * Extract token IDs from market data
 * Returns [upTokenId, downTokenId]
 */
export function extractTokenIds(marketData) {
	if (!marketData?.markets?.[0]?.clobTokenIds) {
		return null;
	}

	const tokenIds = JSON.parse(marketData.markets[0].clobTokenIds);
	return tokenIds;
}

/**
 * Parse outcomes from market data
 */
export function parseOutcomes(marketData) {
	if (!marketData?.markets?.[0]?.outcomes) {
		return ['Up', 'Down'];
	}

	return JSON.parse(marketData.markets[0].outcomes);
}

import fs from 'fs';
import path from 'path';

/**
 * Calculate the Unix timestamp for the current 1-hour window start.
 */
export function getCurrent1hWindowTimestamp() {
	const now = Math.floor(Date.now() / 1000);
	const windowSeconds = 60 * 60; // 1 hour
	return Math.floor(now / windowSeconds) * windowSeconds;
}

/**
 * Get the 1h market slug based on timestamp
 * Format: {full_asset_name}-up-or-down-{month}-{day}-{hour}{am/pm}-et
 */
export function get1hMarketSlug(asset, timestamp) {
	const assetMap = {
		'BTC': 'bitcoin',
		'ETH': 'ethereum',
		'SOL': 'solana',
		'XRP': 'xrp'
	};
	const fullAssetName = assetMap[asset] || asset.toLowerCase();
	
	const date = new Date(timestamp * 1000);
	// Convert to America/New_York (ET)
	const etOptions = {
		timeZone: 'America/New_York',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		hour12: true
	};
	const etParts = new Intl.DateTimeFormat('en-US', etOptions).formatToParts(date);
	
	let month = '', day = '', hour = '', dayPeriod = '';
	for (const part of etParts) {
		if (part.type === 'month') month = part.value.toLowerCase();
		if (part.type === 'day') day = part.value;
		if (part.type === 'hour') hour = part.value;
		if (part.type === 'dayPeriod') dayPeriod = part.value.toLowerCase();
	}
	
	const hourStr = `${hour}${dayPeriod}`; // e.g., 10am
	return `${fullAssetName}-up-or-down-${month}-${day}-${hourStr}-et`;
}

/**
 * Append minimum prices to a CSV file
 */
export function appendMinPricesToCSV(windowStart, combinations, retryCount = 0) {
	const filePath = path.join(process.cwd(), 'market_min_prices.csv');
	const fileExists = fs.existsSync(filePath);

	// Create header if file doesn't exist
	if (!fileExists) {
		fs.writeFileSync(filePath, 'window_start,pair,combination_type,min_sum_price,occurrence_time,retry_count\n');
	}

	const rows = combinations
		.map(c => `"${windowStart}","${c.pair}","${c.label}","${c.minVal}","${c.time}","${retryCount}"`)
		.join('\n');

	if (rows) {
		fs.appendFileSync(filePath, rows + '\n');
	}
}

/**
 * 记录策略分析事件到 rebound.csv
 * 对应设计需求中的数据保存要求
 * 
 * 字段说明:
 * - window_start: 15分钟轮次起点
 * - asset: 资产 (BTC/ETH等)
 * - direction: 方向 (Up/Down)
 * - anchor_time: 锚定时间 (滑动窗口最高点)
 * - anchor_price: 锚定价格 (滑动窗口最高点)
 * - buy_time: 买入时间 (触发闪崩点)
 * - buy_price: 买入价格 (触发闪崩点)
 * - sell_time: 卖出时间 (触发止盈/止损/清仓点)
 * - sell_price: 卖出价格
 * - status: 卖出原因 (TAKE_PROFIT/STOP_LOSS/FORCE_CLEAR)
 */
export function appendStrategyAnalysisToCSV(event) {
	const filePath = path.join(process.cwd(), 'rebound.csv');
	const fileExists = fs.existsSync(filePath);

	if (!fileExists) {
		fs.writeFileSync(filePath, 'window_start,asset,direction,anchor_time,anchor_price,buy_time,buy_price,sell_time,sell_price,status,flash_window,drop_threshold,tp_distance,sl_distance\n');
	}

	const config = event.config || {};
	const row = `"${event.windowStart}","${event.asset}","${event.direction}","${event.anchorTime}","${event.anchorPrice}","${event.buyTime}","${event.buyPrice}","${event.sellTime}","${event.sellPrice}","${event.status}","${config.flashWindow || ''}","${config.dropThreshold || ''}","${config.tpDistance || ''}","${config.slDistance || ''}"`;
	fs.appendFileSync(filePath, row + '\n');
}

/**
 * Append single asset extreme prices to a CSV file
 */
export function appendSingleAssetStatsToCSV(windowStart, stats, retryCount = 0) {
	const filePath = path.join(process.cwd(), 'single_asset_extremes_trade.csv');
	const fileExists = fs.existsSync(filePath);

	if (!fileExists) {
		fs.writeFileSync(filePath, 'window_start,asset,direction,min_ask,min_ask_time,max_ask,max_ask_time,first_below_04,last_below_04,first_back_above_045,retry_count\n');
	}

	const rows = Object.entries(stats)
		.map(([key, data]) => {
			const [asset, direction] = key.split('_');
			return `"${windowStart}","${asset}","${direction}","${data.min}","${data.minTime}","${data.max}","${data.maxTime}","${data.firstBelow04 || ''}","${data.lastBelow04 || ''}","${data.firstBackAbove045 || ''}","${retryCount}"`;
		})
		.join('\n');

	if (rows) {
		fs.appendFileSync(filePath, rows + '\n');
	}
}

/**
 * Append minimum prices to a 1h CSV file
 */
export function appendMinPricesToCSV1h(windowStart, combinations, retryCount = 0) {
	const filePath = path.join(process.cwd(), 'market_min_prices_1h.csv');
	const fileExists = fs.existsSync(filePath);

	if (!fileExists) {
		fs.writeFileSync(filePath, 'window_start,pair,combination_type,min_sum_price,occurrence_time,retry_count\n');
	}

	const rows = combinations
		.map(c => `"${windowStart}","${c.pair}","${c.label}","${c.minVal}","${c.time}","${retryCount}"`)
		.join('\n');

	if (rows) {
		fs.appendFileSync(filePath, rows + '\n');
	}
}

/**
 * Append single asset extreme prices to a 1h CSV file
 */
export function appendSingleAssetStatsToCSV1h(windowStart, stats, retryCount = 0) {
	const filePath = path.join(process.cwd(), 'single_asset_extremes_trade_1h.csv');
	const fileExists = fs.existsSync(filePath);

	if (!fileExists) {
		fs.writeFileSync(filePath, 'window_start,asset,direction,min_ask,min_ask_time,max_ask,max_ask_time,first_below_04,last_below_04,first_back_above_045,retry_count\n');
	}

	const rows = Object.entries(stats)
		.map(([key, data]) => {
			const [asset, direction] = key.split('_');
			return `"${windowStart}","${asset}","${direction}","${data.min}","${data.minTime}","${data.max}","${data.maxTime}","${data.firstBelow04 || ''}","${data.lastBelow04 || ''}","${data.firstBackAbove045 || ''}","${retryCount}"`;
		})
		.join('\n');

	if (rows) {
		fs.appendFileSync(filePath, rows + '\n');
	}
}
