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
	appendStrategyAnalysisToCSV,
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

/*
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
*/

export default function App() {
	const [status, setStatus] = useState('Initializing...');
	const [error, setError] = useState(null);
	const [markets, setMarkets] = useState({}); // { BTC: data, ETH: data, ... }
	const [books, setBooks] = useState({});
	const [minPrices, setMinPrices] = useState({});
	const [countdown, setCountdown] = useState('');
	const [client, setClient] = useState(null);

	// --- 滚动窗口状态池 ---
	// 结构: { [windowStartTimestamp]: data }
	const marketsPoolRef = useRef({});            // 15m 市场数据池
	const markets1hPoolRef = useRef({});          // 1h 市场数据池
	const minPricesPoolRef = useRef({});          // 15m 组合最小值计算池 (UI显示用)
	const minPricesForCSVPoolRef = useRef({});    // 15m 组合最小值保存池
	const minPricesForCSV1hPoolRef = useRef({});  // 1h 组合最小值保存池
	const singleAssetStatsPoolRef = useRef({});   // 15m 单币对极值池
	const singleAssetStats1hPoolRef = useRef({}); // 1h 单币对极值池
	const hasSavedPoolRef = useRef({});           // 已保存窗口记录池 (防止重复写入)
	
	// --- 策略分析相关 ---
	const priceWindowsRef = useRef({});           // { [key]: [{price, ts}, ...] } 15s 滑动窗口
	const strategyEventsRef = useRef({});         // { [key]: { dropStartPrice, ... } } 正在追踪的事件
	
	const totalRetriesRef = useRef(0);
	const activeTokensRef = useRef(new Set());    // 记录当前已订阅的所有 Token

	// --- 核心逻辑说明 ---
	// 1. initMarkets 每 15 分钟运行一次，负责将“当前”和“下一个”窗口加入池中。
	// 2. updateMinPrices 随 WebSocket 价格更新触发，遍历池中所有活跃窗口进行并行计算。
	// 3. 每个窗口独立判断 deadline (10m/55m) 和 saveTime (10m/56m)。
	// 4. 已保存的旧窗口由 initMarkets 负责从池中清理。

	const updateMinPrices = (currentBooks) => {
		const getLowestAsk = (book) => {
			const asks = book?.asks || [];
			if (asks.length === 0) return null;
			const sortedAsks = [...asks].sort((a, b) => Number(a.price) - Number(b.price));
			return Number(sortedAsks[0].price);
		};

		const now = Date.now();
		const timeStr = formatOccurrenceTime(now);
		const current15mTs = getCurrent15MinWindowTimestamp();

		// 通用的极值更新逻辑
		const updateExtremes = (asset, direction, price, statsMap, winTs, isMinStatsPeriod, isMaxStatsPeriod, is1h) => {
			if (price === null) return;
			if (!statsMap[winTs]) statsMap[winTs] = {};
			const key = `${asset}_${direction}`;
			if (!statsMap[winTs][key]) {
				const isBelow04 = price <= 0.4;
				statsMap[winTs][key] = {
					min: price, minTime: timeStr, max: price, maxTime: timeStr,
					firstBelow04: isBelow04 ? timeStr : '', 
					lastBelow04: isBelow04 ? timeStr : '',
					hasBeenBelow04: isBelow04,
					firstBackAbove045: ''
				};
			} else {
				const stats = statsMap[winTs][key];
				if (isMinStatsPeriod && price < stats.min) { stats.min = price; stats.minTime = timeStr; }
				if (isMaxStatsPeriod && price > stats.max) { stats.max = price; stats.maxTime = timeStr; }
				if (isMaxStatsPeriod) {
					if (price <= 0.4) { 
						if (!stats.firstBelow04) stats.firstBelow04 = timeStr; 
						stats.lastBelow04 = timeStr; 
						stats.hasBeenBelow04 = true;
					}
					if (price >= 0.45 && stats.hasBeenBelow04 && !stats.firstBackAbove045) {
						stats.firstBackAbove045 = timeStr;
					}
				}
			}

			// --- 策略分析逻辑 (15s跌0.08, 回升0.05) ---
			// 只在 15m 活跃窗口且不在 3 分钟禁区内进行新的检测
			// 增加 winTs === current15mTs 判定，确保每个价格更新只被处理一次
			const winStartMs = winTs * 1000;
			const is15m = !is1h;
			const windowDuration = is15m ? 15 * 60 * 1000 : 60 * 60 * 1000;
			const isBufferZone = (now - winStartMs) > (windowDuration - 3 * 60 * 1000);

			if (is15m && winTs === current15mTs) {
				const strategyKey = `${asset}_${direction}`;
				
				// 1. 更新 15s 滑动窗口
				if (!priceWindowsRef.current[strategyKey]) priceWindowsRef.current[strategyKey] = [];
				const window = priceWindowsRef.current[strategyKey];
				window.push({ price, ts: now });
				// 移除 15s 之前的数据
				while (window.length > 0 && window[0].ts < now - 15000) {
					window.shift();
				}

				// 2. 如果已经在追踪事件，检查回升
				const pendingEvent = strategyEventsRef.current[strategyKey];
				if (pendingEvent) {
					// 检查是否进一步下跌 0.05 (反弹失败)
					if (price <= pendingEvent.triggerPrice - 0.05) {
						delete strategyEventsRef.current[strategyKey];
						// 注意：这里不要 return，否则会跳过后续的组合最小值等逻辑更新
					} else {
						// 持续更新急跌后的最低点
						if (price < pendingEvent.dropEndPrice) {
							pendingEvent.dropEndPrice = price;
							pendingEvent.dropEndTime = timeStr;
						}
						// 检查回升是否达标 (0.05)
						if (price - pendingEvent.dropEndPrice >= 0.05) {
							appendStrategyAnalysisToCSV({
								...pendingEvent,
								reboundTime: timeStr,
								reboundPrice: price
							});
							delete strategyEventsRef.current[strategyKey]; // 完成记录
						}
						// 如果进入了 3 分钟禁区，强制结束当前追踪（但不一定记录，因为回升未达标）
						if (isBufferZone) {
							delete strategyEventsRef.current[strategyKey];
						}
					}
				} 
				// 3. 如果不在追踪且不在禁区，检查新的急跌
				else if (!isBufferZone && window.length > 1) {
					const maxPriceObj = window.reduce((max, p) => p.price > max.price ? p : max, window[0]);
					if (maxPriceObj.price - price > 0.08) {
						strategyEventsRef.current[strategyKey] = {
							windowStart: formatWindowTime(winTs),
							asset,
							direction,
							dropStartTime: formatOccurrenceTime(maxPriceObj.ts),
							dropStartPrice: maxPriceObj.price,
							triggerPrice: price, // 记录触发时的价格，用于判断进一步下跌
							dropEndTime: timeStr,
							dropEndPrice: price
						};
					}
				}
			}
		};

		// 处理单个窗口的逻辑 (15m 或 1h)
		const processWindow = (winTs, type) => {
			const is1h = type === '1h';
			const markets = is1h ? markets1hPoolRef.current[winTs] : marketsPoolRef.current[winTs];
			if (!markets) return;

			const winStartMs = winTs * 1000;
			const elapsed = now - winStartMs;
			
			// 计算窗口参数
			const deadline = is1h ? 55 * 60 * 1000 : 10 * 60 * 1000; // 截止计分时间
			const saveTime = is1h ? 56 * 60 * 1000 : 10 * 60 * 1000; // 触发保存时间 (15m 也是 10min)
			const isWarmup = elapsed < 0; // 是否在预热阶段 (T-15min 到 T)
			const isActive = elapsed >= 0 && elapsed < deadline; // 是否在计分阶段
			const isSavePeriod = elapsed >= saveTime; // 是否到达保存时间

			if (isWarmup || isActive) {
				ASSETS.forEach((assetA, i) => {
					ASSETS.slice(i + 1).forEach(assetB => {
						const dataA = markets[assetA];
						const dataB = markets[assetB];
						if (!dataA || !dataB) return;

						const idsA = extractTokenIds(dataA);
						const idsB = extractTokenIds(dataB);
						if (!idsA || !idsB) return;

						const prices = {
							aUp: getLowestAsk(currentBooks[idsA[0]]),
							aDown: getLowestAsk(currentBooks[idsA[1]]),
							bUp: getLowestAsk(currentBooks[idsB[0]]),
							bDown: getLowestAsk(currentBooks[idsB[1]])
						};

						// 更新单币对极值
						const statsPool = is1h ? singleAssetStats1hPoolRef : singleAssetStatsPoolRef;
						const isMinPeriod = is1h ? true : (elapsed < 5 * 60 * 1000); // 15m 只有前5分钟计最小值
						updateExtremes(assetA, 'Up', prices.aUp, statsPool.current, winTs, isMinPeriod, true, is1h);
						updateExtremes(assetA, 'Down', prices.aDown, statsPool.current, winTs, isMinPeriod, true, is1h);
						updateExtremes(assetB, 'Up', prices.bUp, statsPool.current, winTs, isMinPeriod, true, is1h);
						updateExtremes(assetB, 'Down', prices.bDown, statsPool.current, winTs, isMinPeriod, true, is1h);

						// 更新组合最小值
						const updateComboMin = (asset1, asset2, p1, p2, suffix, pool) => {
							if (p1 === null || p2 === null) return;
							const val = p1 + p2;
							const key = `${asset1}_${asset2}_${suffix}`;
							if (!pool.current[winTs]) pool.current[winTs] = {};
							if (!pool.current[winTs][key] || val < pool.current[winTs][key].val) {
								pool.current[winTs][key] = { val, time: timeStr };
								// 如果是当前 UI 窗口，同步更新到 minPricesPool 用于展示
								if (!is1h && winTs === current15mTs) {
									if (!minPricesPoolRef.current[winTs]) minPricesPoolRef.current[winTs] = {};
									minPricesPoolRef.current[winTs][key] = { val, time: timeStr };
								}
							}
						};

						const comboPool = is1h ? minPricesForCSV1hPoolRef : minPricesForCSVPoolRef;
						updateComboMin(assetA, assetB, prices.aUp, prices.bDown, '1', comboPool);
						updateComboMin(assetA, assetB, prices.bUp, prices.aDown, '2', comboPool);
					});
				});

				// 如果更新了当前 UI 窗口，触发界面渲染
				if (!is1h && winTs === current15mTs && minPricesPoolRef.current[winTs]) {
					setMinPrices({ ...minPricesPoolRef.current[winTs] });
				}
			}

			// 保存逻辑
			if (isSavePeriod && !hasSavedPoolRef.current[winTs]) {
				const comboPool = is1h ? minPricesForCSV1hPoolRef : minPricesForCSVPoolRef;
				const statsPool = is1h ? singleAssetStats1hPoolRef : singleAssetStatsPoolRef;
				const saveFn = is1h ? appendMinPricesToCSV1h : appendMinPricesToCSV;
				const saveStatsFn = is1h ? appendSingleAssetStatsToCSV1h : appendSingleAssetStatsToCSV;

				if (comboPool.current[winTs]) {
					const windowStr = formatWindowTime(winTs);
					const combinationsToSave = [];
					ASSETS.forEach((assetA, i) => {
						ASSETS.slice(i + 1).forEach(assetB => {
							['1', '2'].forEach(suffix => {
								const key = `${assetA}_${assetB}_${suffix}`;
								const data = comboPool.current[winTs][key];
								if (data) {
									combinationsToSave.push({
										pair: `${assetA} & ${assetB}`,
										label: suffix === '1' ? `${assetA} Up + ${assetB} Down` : `${assetB} Up + ${assetA} Down`,
										minVal: data.val.toFixed(3),
										time: data.time
									});
								}
							});
						});
					});

					if (combinationsToSave.length > 0) {
						saveFn(windowStr, combinationsToSave, totalRetriesRef.current);
						if (statsPool.current[winTs]) {
							saveStatsFn(windowStr, statsPool.current[winTs], totalRetriesRef.current);
						}
						hasSavedPoolRef.current[winTs] = true;
						console.log(`Saved ${type} market data for ${windowStr}`);
					}
				}
			}
		};

		// 遍历所有活跃窗口进行处理
		Object.keys(marketsPoolRef.current).forEach(ts => processWindow(parseInt(ts), '15m'));
		Object.keys(markets1hPoolRef.current).forEach(ts => processWindow(parseInt(ts), '1h'));
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

				const nowTs = Math.floor(Date.now() / 1000);
				const current15m = getCurrent15MinWindowTimestamp();
				const next15m = getNext15MinWindowTimestamp();
				const current1h = getCurrent1hWindowTimestamp();
				const next1h = current1h + 3600;

				// 1. 清理已保存且过期的窗口 (内存管理)
				[marketsPoolRef, markets1hPoolRef, minPricesPoolRef, minPricesForCSVPoolRef, 
				 minPricesForCSV1hPoolRef, singleAssetStatsPoolRef, singleAssetStats1hPoolRef].forEach(pool => {
					Object.keys(pool.current).forEach(ts => {
						const tsNum = parseInt(ts);
						// 如果窗口已保存，且时间早于当前活跃窗口的预热起点，则删除
						if (hasSavedPoolRef.current[ts] && tsNum < current15m - 900) {
							delete pool.current[ts];
						}
					});
				});

				// 2. 准备需要加载的窗口列表 (15m 和 1h)
				const windowsToLoad = [
					{ ts: current15m, type: '15m' },
					{ ts: next15m, type: '15m' },
					{ ts: current1h, type: '1h' },
					{ ts: next1h, type: '1h' }
				];

				const newTokens = [];
				for (const win of windowsToLoad) {
					const pool = win.type === '15m' ? marketsPoolRef : markets1hPoolRef;
					// 如果该窗口还没在池子里，或者数据不全，则加载
					if (!pool.current[win.ts]) {
						pool.current[win.ts] = {};
						for (const asset of ASSETS) {
							const slug = win.type === '15m' 
								? buildMarketSlug(asset, win.ts) 
								: get1hMarketSlug(asset, win.ts);
							try {
								setStatus(`Fetching ${asset} ${win.ts} ${win.type}...`);
								const data = await fetchMarketData(slug);
								pool.current[win.ts][asset] = data;
								const tokens = extractTokenIds(data);
								if (tokens) {
									tokens.forEach(id => {
										if (!activeTokensRef.current.has(id)) {
											newTokens.push(id);
											activeTokensRef.current.add(id);
										}
									});
								}
							} catch (err) {
								console.error(`Fetch failed for ${slug}: ${err.message}`);
							}
						}
					}
				}

				// 3. 更新 UI 显示用的当前市场
				setMarkets(marketsPoolRef.current[current15m] || {});

				// 4. WebSocket 连接管理
				if (!currentClient) {
					setStatus('Connecting to WebSocket...');
					currentClient = new ClobMarketClient();
					setClient(currentClient);

					currentClient.on('connected', () => {
						setStatus('Connected - Subscribing...');
						if (activeTokensRef.current.size > 0) {
							currentClient.subscribe(Array.from(activeTokensRef.current));
						}
					});

					currentClient.on('error', err => {
						setStatus(`WebSocket error: ${err.message}. Retrying...`);
						setTimeout(() => initMarkets(0), 5000);
					});

					currentClient.onBook(event => {
						setBooks(prev => {
							const next = { ...prev, [event.asset_id]: { bids: event.bids || [], asks: event.asks || [] } };
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
								if (Number(change.size) === 0) { if (idx !== -1) orders.splice(idx, 1); }
								else if (idx !== -1) { orders[idx] = {price: change.price, size: change.size}; }
								else { orders.push({price: change.price, size: change.size}); }
							}
							const next = { ...prev, [event.asset_id]: { bids: newBids, asks: newAsks } };
							updateMinPrices(next);
							return next;
						});
					});

					await currentClient.connect();
				} else if (newTokens.length > 0) {
					// 已有连接，追加订阅新 Token
					setStatus(`Subscribing to ${newTokens.length} new tokens...`);
					currentClient.subscribe(newTokens);
				}

				// 5. 调度下一次检查 (15分钟后)
				const msUntilNext = getMsUntilNextWindow();
				if (switchTimeout) clearTimeout(switchTimeout);
				switchTimeout = setTimeout(() => initMarkets(), msUntilNext + 2000);

			} catch (err) {
				console.error('initMarkets error:', err);
				if (retryCount < 10) {
					retryTimeout = setTimeout(() => initMarkets(retryCount + 1), 5000);
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

			{/* <PriceCombinations markets={markets} books={books} minPrices={minPrices} /> */}
		</Box>
	);
}
