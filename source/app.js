import React, {useState, useEffect, useRef} from 'react';
import {Box, Text} from 'ink';
import {ClobMarketClient} from 'polymarket-websocket-client';
import {
	getCurrent15MinWindowTimestamp,
	getNext15MinWindowTimestamp,
	getMsUntilNextWindow,
	formatWindowTime,
	formatOccurrenceTime,
	buildMarketSlug,
	fetchMarketData,
	extractTokenIds,
	parseOutcomes,
	appendMinPricesToCSV,
	appendSingleAssetStatsToCSV,
	getCurrent1hWindowTimestamp,
	get1hMarketSlug,
	appendMinPricesToCSV1h,
	appendSingleAssetStatsToCSV1h,
} from './utils.js';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'];

function OrderbookSide({orders, side, maxRows = 1}) {
	const isBid = side === 'bid';
	const color = isBid ? 'green' : 'red';
	const sortedOrders = [...orders].sort((a, b) =>
		isBid
			? Number(b.price) - Number(a.price)
			: Number(a.price) - Number(b.price),
	);
	const displayOrders = sortedOrders.slice(0, maxRows);

	return (
		<Box flexDirection="column" width={24}>
			<Text bold color={color}>
				{isBid ? 'BIDS' : 'ASKS'}
			</Text>
			<Box>
				<Text dimColor>{'Price'.padEnd(10)}Size</Text>
			</Box>
			{displayOrders.length === 0 ? (
				<Text dimColor>No orders</Text>
			) : (
				displayOrders.map((order, i) => (
					<Text key={`${order.price}-${i}`} color={color}>
						{Number(order.price).toFixed(2).padEnd(10)}
						{Number(order.size).toFixed(0)}
					</Text>
				))
			)}
		</Box>
	);
}

function TokenOrderbook({tokenId, label, book}) {
	const bids = book?.bids || [];
	const asks = book?.asks || [];

	return (
		<Box
			flexDirection="column"
			marginRight={2}
			borderStyle="round"
			paddingX={1}
		>
			<Text bold underline>
				{label}
			</Text>
			<Box marginTop={1}>
				<OrderbookSide orders={bids} side="bid" />
				<Box width={2} />
				<OrderbookSide orders={asks} side="ask" />
			</Box>
		</Box>
	);
}

function AssetSection({asset, marketData, books}) {
	if (!marketData) return null;

	const tokenIds = extractTokenIds(marketData);
	const outcomes = parseOutcomes(marketData);

	if (!tokenIds) return null;

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text bold color="yellow">
				{asset} - {marketData.title}
			</Text>
			<Box>
				{outcomes.map((outcome, idx) => (
					<TokenOrderbook
						key={tokenIds[idx]}
						tokenId={tokenIds[idx]}
						label={outcome}
						book={books[tokenIds[idx]]}
					/>
				))}
			</Box>
		</Box>
	);
}

function PriceCombinations({markets, books, minPrices}) {
	const getLowestAsk = (book) => {
		const asks = book?.asks || [];
		if (asks.length === 0) return null;
		const sortedAsks = [...asks].sort((a, b) => Number(a.price) - Number(b.price));
		return Number(sortedAsks[0].price);
	};

	const combinations = [];
	for (let i = 0; i < ASSETS.length; i++) {
		for (let j = i + 1; j < ASSETS.length; j++) {
			const assetA = ASSETS[i];
			const assetB = ASSETS[j];

			const dataA = markets[assetA];
			const dataB = markets[assetB];

			if (dataA && dataB) {
				const idsA = extractTokenIds(dataA);
				const idsB = extractTokenIds(dataB);

				if (idsA && idsB) {
					const aUpAsk = getLowestAsk(books[idsA[0]]);
					const aDownAsk = getLowestAsk(books[idsA[1]]);
					const bUpAsk = getLowestAsk(books[idsB[0]]);
					const bDownAsk = getLowestAsk(books[idsB[1]]);

					const key1 = `${assetA}_${assetB}_1`;
					const key2 = `${assetA}_${assetB}_2`;

					combinations.push({
						pair: `${assetA} & ${assetB}`,
						val1: (aUpAsk !== null && bDownAsk !== null) ? (aUpAsk + bDownAsk).toFixed(3) : 'N/A',
						val2: (bUpAsk !== null && aDownAsk !== null) ? (bUpAsk + aDownAsk).toFixed(3) : 'N/A',
						minVal1: minPrices[key1] ? minPrices[key1].val.toFixed(3) : 'N/A',
						minVal2: minPrices[key2] ? minPrices[key2].val.toFixed(3) : 'N/A',
						minTime1: minPrices[key1]?.time,
						minTime2: minPrices[key2]?.time,
						label1: `${assetA} Up + ${assetB} Down`,
						label2: `${assetB} Up + ${assetA} Down`
					});
				}
			}
		}
	}

	return (
		<Box flexDirection="column" marginTop={1} borderStyle="double" paddingX={1}>
			<Text bold color="cyan">** Price Combinations (Sum of Lowest Asks) **</Text>
			<Box flexDirection="row" flexWrap="wrap">
				{combinations.map((c, i) => (
					<Box key={i} flexDirection="column" marginRight={4} marginBottom={1}>
						<Text bold underline>{c.pair}:</Text>
						<Text>  - {c.label1.padEnd(18)}: <Text color="magenta">{c.val1}</Text> <Text dimColor>(Min: {c.minVal1}{c.minTime1 ? ` at ${c.minTime1}` : ''})</Text></Text>
						<Text>  - {c.label2.padEnd(18)}: <Text color="magenta">{c.val2}</Text> <Text dimColor>(Min: {c.minVal2}{c.minTime2 ? ` at ${c.minTime2}` : ''})</Text></Text>
					</Box>
				))}
			</Box>
		</Box>
	);
}

export default function App() {
	const [status, setStatus] = useState('Initializing...');
	const [error, setError] = useState(null);
	const [markets, setMarkets] = useState({}); // { BTC: data, ETH: data, ... }
	const [books, setBooks] = useState({});
	const [minPrices, setMinPrices] = useState({});
	const [countdown, setCountdown] = useState('');
	const [client, setClient] = useState(null);

	const minPricesRef = useRef({});
	const minPricesForCSVRef = useRef({});
	const marketsRef = useRef({});
	const markets1hRef = useRef({});
	const singleAssetStatsRef = useRef({});
	const singleAssetStats1hRef = useRef({});
	const minPricesForCSV1hRef = useRef({});
	const hasSavedRef = useRef(false);
	const hasSaved1hRef = useRef(false);
	const totalRetriesRef = useRef(0);
	const lastWindowStart1hRef = useRef(null);

	// Update marketsRef whenever markets state changes
	useEffect(() => {
		marketsRef.current = markets;
	}, [markets]);

	const updateMinPrices = (currentBooks) => {
		const getLowestAsk = (book) => {
			const asks = book?.asks || [];
			if (asks.length === 0) return null;
			const sortedAsks = [...asks].sort((a, b) => Number(a.price) - Number(b.price));
			return Number(sortedAsks[0].price);
		};

		const windowStart = getCurrent15MinWindowTimestamp() * 1000;
		const elapsed = Date.now() - windowStart;
		const isWithinFirst5Min = elapsed < 5 * 60 * 1000;
		const isWithinFirst10Min = elapsed < 10 * 60 * 1000;
		const isAfter10Min = elapsed >= 10 * 60 * 1000;

		const windowStart1h = getCurrent1hWindowTimestamp() * 1000;
		const elapsed1h = Date.now() - windowStart1h;
		const isWithinFirst55Min1h = elapsed1h < 55 * 60 * 1000;
		const isAfter55Min1h = elapsed1h >= 55 * 60 * 1000;
		const isSaveTime1h = elapsed1h >= 56 * 60 * 1000;

		const now = Date.now();
		const timeStr = formatOccurrenceTime(now);

		const updateSingleAssetExtremes = (asset, direction, price, statsRef, isMinStatsPeriod, isMaxStatsPeriod) => {
			if (price === null) return;
			const key = `${asset}_${direction}`;
			if (!statsRef.current[key]) {
				statsRef.current[key] = {
					min: price,
					minTime: timeStr,
					max: price,
					maxTime: timeStr,
					firstBelow04: price < 0.4 ? timeStr : '',
					lastBelow04: price < 0.4 ? timeStr : '',
					firstAbove06: price > 0.6 ? timeStr : '',
					lastAbove06: price > 0.6 ? timeStr : ''
				};
			} else {
				const stats = statsRef.current[key];
				if (isMinStatsPeriod && price < stats.min) {
					stats.min = price;
					stats.minTime = timeStr;
				}
				if (isMaxStatsPeriod && price > stats.max) {
					stats.max = price;
					stats.maxTime = timeStr;
				}

				// 区间统计 logic
				if (isMaxStatsPeriod) {
					if (price < 0.4) {
						if (!stats.firstBelow04) stats.firstBelow04 = timeStr;
						stats.lastBelow04 = timeStr;
					}
					if (price > 0.6) {
						if (!stats.firstAbove06) stats.firstAbove06 = timeStr;
						stats.lastAbove06 = timeStr;
					}
				}
			}
		};

		let changed = false;
		const currentMarkets = marketsRef.current;
		const currentMarkets1h = markets1hRef.current;

		ASSETS.forEach((assetA, i) => {
			ASSETS.slice(i + 1).forEach(assetB => {
				// --- 15m Logic ---
				const dataA = currentMarkets[assetA];
				const dataB = currentMarkets[assetB];
				if (dataA && dataB) {
					const idsA = extractTokenIds(dataA);
					const idsB = extractTokenIds(dataB);
					if (idsA && idsB) {
						const aUpAsk = getLowestAsk(currentBooks[idsA[0]]);
						const aDownAsk = getLowestAsk(currentBooks[idsA[1]]);
						const bUpAsk = getLowestAsk(currentBooks[idsB[0]]);
						const bDownAsk = getLowestAsk(currentBooks[idsB[1]]);

						if (isWithinFirst10Min) {
							updateSingleAssetExtremes(assetA, 'Up', aUpAsk, singleAssetStatsRef, isWithinFirst5Min, true);
							updateSingleAssetExtremes(assetA, 'Down', aDownAsk, singleAssetStatsRef, isWithinFirst5Min, true);
							updateSingleAssetExtremes(assetB, 'Up', bUpAsk, singleAssetStatsRef, isWithinFirst5Min, true);
							updateSingleAssetExtremes(assetB, 'Down', bDownAsk, singleAssetStatsRef, isWithinFirst5Min, true);
						}

						if (aUpAsk !== null && bDownAsk !== null) {
							const val = aUpAsk + bDownAsk;
							const key = `${assetA}_${assetB}_1`;
							if (!minPricesRef.current[key] || val < minPricesRef.current[key].val) {
								minPricesRef.current[key] = { val, time: timeStr };
								changed = true;
							}
							if (isWithinFirst10Min) {
								if (!minPricesForCSVRef.current[key] || val < minPricesForCSVRef.current[key].val) {
									minPricesForCSVRef.current[key] = { val, time: timeStr };
								}
							}
						}

						if (bUpAsk !== null && aDownAsk !== null) {
							const val = bUpAsk + aDownAsk;
							const key = `${assetA}_${assetB}_2`;
							if (!minPricesRef.current[key] || val < minPricesRef.current[key].val) {
								minPricesRef.current[key] = { val, time: timeStr };
								changed = true;
							}
							if (isWithinFirst10Min) {
								if (!minPricesForCSVRef.current[key] || val < minPricesForCSVRef.current[key].val) {
									minPricesForCSVRef.current[key] = { val, time: timeStr };
								}
							}
						}
					}
				}

				// --- 1h Logic (Background) ---
				const dataA1h = currentMarkets1h[assetA];
				const dataB1h = currentMarkets1h[assetB];
				if (dataA1h && dataB1h) {
					const idsA1h = extractTokenIds(dataA1h);
					const idsB1h = extractTokenIds(dataB1h);
					if (idsA1h && idsB1h) {
						const aUpAsk = getLowestAsk(currentBooks[idsA1h[0]]);
						const aDownAsk = getLowestAsk(currentBooks[idsA1h[1]]);
						const bUpAsk = getLowestAsk(currentBooks[idsB1h[0]]);
						const bDownAsk = getLowestAsk(currentBooks[idsB1h[1]]);

						if (isWithinFirst55Min1h) {
							updateSingleAssetExtremes(assetA, 'Up', aUpAsk, singleAssetStats1hRef, true, true);
							updateSingleAssetExtremes(assetA, 'Down', aDownAsk, singleAssetStats1hRef, true, true);
							updateSingleAssetExtremes(assetB, 'Up', bUpAsk, singleAssetStats1hRef, true, true);
							updateSingleAssetExtremes(assetB, 'Down', bDownAsk, singleAssetStats1hRef, true, true);

							if (aUpAsk !== null && bDownAsk !== null) {
								const val = aUpAsk + bDownAsk;
								const key = `${assetA}_${assetB}_1`;
								if (!minPricesForCSV1hRef.current[key] || val < minPricesForCSV1hRef.current[key].val) {
									minPricesForCSV1hRef.current[key] = { val, time: timeStr };
								}
							}

							if (bUpAsk !== null && aDownAsk !== null) {
								const val = bUpAsk + aDownAsk;
								const key = `${assetA}_${assetB}_2`;
								if (!minPricesForCSV1hRef.current[key] || val < minPricesForCSV1hRef.current[key].val) {
									minPricesForCSV1hRef.current[key] = { val, time: timeStr };
								}
							}
						}
					}
				}
			});
		});

		if (changed) {
			setMinPrices({...minPricesRef.current});
		}

		// Auto-save 15m CSV after 10 minutes
		if (isAfter10Min && !hasSavedRef.current && Object.keys(minPricesForCSVRef.current).length > 0) {
			const windowStr = formatWindowTime(windowStart / 1000);
			const combinationsToSave = [];
			ASSETS.forEach((assetA, i) => {
				ASSETS.slice(i + 1).forEach(assetB => {
					const key1 = `${assetA}_${assetB}_1`;
					const key2 = `${assetA}_${assetB}_2`;
					if (minPricesForCSVRef.current[key1]) {
						combinationsToSave.push({
							pair: `${assetA} & ${assetB}`,
							label: `${assetA} Up + ${assetB} Down`,
							minVal: minPricesForCSVRef.current[key1].val.toFixed(3),
							time: minPricesForCSVRef.current[key1].time
						});
					}
					if (minPricesForCSVRef.current[key2]) {
						combinationsToSave.push({
							pair: `${assetA} & ${assetB}`,
							label: `${assetB} Up + ${assetA} Down`,
							minVal: minPricesForCSVRef.current[key2].val.toFixed(3),
							time: minPricesForCSVRef.current[key2].time
						});
					}
				});
			});
			if (combinationsToSave.length > 0) {
				appendMinPricesToCSV(windowStr, combinationsToSave, totalRetriesRef.current);
				if (Object.keys(singleAssetStatsRef.current).length > 0) {
					appendSingleAssetStatsToCSV(windowStr, singleAssetStatsRef.current, totalRetriesRef.current);
				}
				hasSavedRef.current = true;
			}
		}

		// Auto-save 1h CSV after 55 minutes (at 56th min)
		if (isSaveTime1h && !hasSaved1hRef.current && Object.keys(minPricesForCSV1hRef.current).length > 0) {
			const windowStr = formatWindowTime(windowStart1h / 1000);
			const combinationsToSave = [];
			ASSETS.forEach((assetA, i) => {
				ASSETS.slice(i + 1).forEach(assetB => {
					const key1 = `${assetA}_${assetB}_1`;
					const key2 = `${assetA}_${assetB}_2`;
					if (minPricesForCSV1hRef.current[key1]) {
						combinationsToSave.push({
							pair: `${assetA} & ${assetB}`,
							label: `${assetA} Up + ${assetB} Down`,
							minVal: minPricesForCSV1hRef.current[key1].val.toFixed(3),
							time: minPricesForCSV1hRef.current[key1].time
						});
					}
					if (minPricesForCSV1hRef.current[key2]) {
						combinationsToSave.push({
							pair: `${assetA} & ${assetB}`,
							label: `${assetB} Up + ${assetA} Down`,
							minVal: minPricesForCSV1hRef.current[key2].val.toFixed(3),
							time: minPricesForCSV1hRef.current[key2].time
						});
					}
				});
			});
			if (combinationsToSave.length > 0) {
				appendMinPricesToCSV1h(windowStr, combinationsToSave, totalRetriesRef.current);
				if (Object.keys(singleAssetStats1hRef.current).length > 0) {
					appendSingleAssetStatsToCSV1h(windowStr, singleAssetStats1hRef.current, totalRetriesRef.current);
				}
				hasSaved1hRef.current = true;
			}
		}
	};

	// Initialize and switch markets
	useEffect(() => {
		let currentClient = null;
		let switchTimeout = null;
		let countdownInterval = null;
		let retryTimeout = null;

		async function initMarkets(retryCount = 0) {
			try {
				if (retryTimeout) clearTimeout(retryTimeout);
				setError(null);
				
				// Disconnect previous client
				if (currentClient) {
					currentClient.disconnect();
				}

				const timestamp = getCurrent15MinWindowTimestamp();
				const timestamp1h = getCurrent1hWindowTimestamp();

				if (retryCount === 0) {
					// 15m Resets
					setBooks({});
					setMinPrices({});
					setMarkets({});
					marketsRef.current = {};
					minPricesRef.current = {};
					minPricesForCSVRef.current = {};
					singleAssetStatsRef.current = {};
					hasSavedRef.current = false;
					totalRetriesRef.current = 0;

					// 1h Resets - only on hour change
					if (lastWindowStart1hRef.current !== timestamp1h) {
						markets1hRef.current = {};
						minPricesForCSV1hRef.current = {};
						singleAssetStats1hRef.current = {};
						hasSaved1hRef.current = false;
						lastWindowStart1hRef.current = timestamp1h;
					}
				} else {
					totalRetriesRef.current += 1;
				}
				const newMarkets = {};
				const newMarkets1h = {};
				const allTokens = [];
				let lastFetchError = '';

				for (const asset of ASSETS) {
					// 15m Market
					const slug15m = buildMarketSlug(asset, timestamp);
					try {
						setStatus(`Fetching ${asset} 15m market... ${retryCount > 0 ? `(Retry ${retryCount}/10)` : ''}`);
						const data = await fetchMarketData(slug15m);
						newMarkets[asset] = data;
						const tokens = extractTokenIds(data);
						if (tokens) allTokens.push(...tokens);
					} catch (err) {
						console.error(`Failed to fetch ${asset} 15m market: ${err.message}`);
					}

					// 1h Market
					const slug1h = get1hMarketSlug(asset, timestamp1h);
					try {
						setStatus(`Fetching ${asset} 1h market... ${retryCount > 0 ? `(Retry ${retryCount}/10)` : ''}`);
						const data = await fetchMarketData(slug1h);
						newMarkets1h[asset] = data;
						const tokens = extractTokenIds(data);
						if (tokens) allTokens.push(...tokens);
					} catch (err) {
						console.error(`Failed to fetch ${asset} 1h market: ${err.message}`);
					}
				}

				setMarkets(newMarkets);
				markets1hRef.current = newMarkets1h;

				if (allTokens.length === 0) {
					throw new Error(lastFetchError || 'No token IDs found for any market');
				}

				setStatus('Connecting to WebSocket...');

				// Create WebSocket client
				currentClient = new ClobMarketClient();
				setClient(currentClient);

				currentClient.on('connected', () => {
					setStatus('Connected - Subscribing...');
					currentClient.subscribe(allTokens);
				});

				currentClient.on('disconnected', () => {
					setStatus('Disconnected');
				});

				currentClient.on('error', err => {
					const msg = `WebSocket error: ${err.message}`;
					setStatus(`${msg}. Retrying in 5s...`);
					totalRetriesRef.current += 1;
					if (retryTimeout) clearTimeout(retryTimeout);
					retryTimeout = setTimeout(() => initMarkets(0), 5000);
				});

				currentClient.onBook(event => {
					setStatus('Receiving orderbook updates');
					setBooks(prev => {
						const next = {
							...prev,
							[event.asset_id]: {
								bids: event.bids || [],
								asks: event.asks || [],
							},
						};
						updateMinPrices(next);
						return next;
					});
				});

				currentClient.onPriceChange(event => {
					setBooks(prev => {
						const current = prev[event.asset_id] || {bids: [], asks: []};
						let newBids = [...current.bids];
						let newAsks = [...current.asks];

						for (const change of event.price_changes || []) {
							const side = change.side === 'BUY' ? 'bids' : 'asks';
							let orders = side === 'bids' ? newBids : newAsks;

							const idx = orders.findIndex(o => o.price === change.price);

							if (Number(change.size) === 0) {
								if (idx !== -1) orders.splice(idx, 1);
							} else if (idx !== -1) {
								orders[idx] = {price: change.price, size: change.size};
							} else {
								orders.push({price: change.price, size: change.size});
							}
						}

						const next = {
							...prev,
							[event.asset_id]: {
								bids: newBids,
								asks: newAsks,
							},
						};
						updateMinPrices(next);
						return next;
					});
				});

				await currentClient.connect();

				// Schedule switch to next window
				const msUntilNext = getMsUntilNextWindow();
				if (switchTimeout) clearTimeout(switchTimeout);
				switchTimeout = setTimeout(() => {
					initMarkets();
				}, msUntilNext + 2000);
			} catch (err) {
				if (retryCount < 10) {
					const nextRetryDelay = 5000;
					setStatus(`Error: ${err.message}. Retrying in 5s... (${retryCount + 1}/10)`);
					retryTimeout = setTimeout(() => initMarkets(retryCount + 1), nextRetryDelay);
				} else {
					setError(`Fatal Error: ${err.message}. Max retries reached.`);
					setStatus('Stopped due to errors');
				}
			}
		}

		// Countdown timer
		countdownInterval = setInterval(() => {
			const ms = getMsUntilNextWindow();
			const seconds = Math.floor(ms / 1000);
			const minutes = Math.floor(seconds / 60);
			const secs = seconds % 60;
			setCountdown(`${minutes}:${secs.toString().padStart(2, '0')}`);
		}, 1000);

		initMarkets();

		return () => {
			if (currentClient) currentClient.disconnect();
			if (switchTimeout) clearTimeout(switchTimeout);
			if (countdownInterval) clearInterval(countdownInterval);
			if (retryTimeout) clearTimeout(retryTimeout);
		};
	}, []);

	const windowStart = formatWindowTime(getCurrent15MinWindowTimestamp());
	const windowEnd = formatWindowTime(getNext15MinWindowTimestamp());

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color="cyan">
					Polymarket 15m Up/Down Orderbooks (BTC, ETH, SOL, XRP)
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text>
					<Text bold>Window:</Text> {windowStart} - {windowEnd}
				</Text>
				<Text> | </Text>
				<Text>
					<Text bold>Next:</Text> {countdown}
				</Text>
				<Text> | </Text>
				<Text color={status.includes('Error') || status.includes('Failed') ? 'red' : 'dimColor'}>{status}</Text>
			</Box>

			{ASSETS.map(asset => (
				<AssetSection
					key={asset}
					asset={asset}
					marketData={markets[asset]}
					books={books}
				/>
			))}

			<PriceCombinations markets={markets} books={books} minPrices={minPrices} />
		</Box>
	);
}
