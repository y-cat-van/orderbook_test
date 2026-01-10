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
 * Append single asset extreme prices to a CSV file
 */
export function appendSingleAssetStatsToCSV(windowStart, stats, retryCount = 0) {
	const filePath = path.join(process.cwd(), 'single_asset_extremes.csv');
	const fileExists = fs.existsSync(filePath);

	if (!fileExists) {
		fs.writeFileSync(filePath, 'window_start,asset,direction,min_ask,min_ask_time,max_ask,max_ask_time,first_below_04,last_below_04,first_above_06,last_above_06,retry_count\n');
	}

	const rows = Object.entries(stats)
		.map(([key, data]) => {
			const [asset, direction] = key.split('_');
			return `"${windowStart}","${asset}","${direction}","${data.min}","${data.minTime}","${data.max}","${data.maxTime}","${data.firstBelow04 || ''}","${data.lastBelow04 || ''}","${data.firstAbove06 || ''}","${data.lastAbove06 || ''}","${retryCount}"`;
		})
		.join('\n');

	if (rows) {
		fs.appendFileSync(filePath, rows + '\n');
	}
}
