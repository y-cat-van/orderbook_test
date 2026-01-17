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
	const lastUpdateRef = useRef(0); // 用于节流
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
		const now = Date.now();
		// 节流：控制计算和渲染频率，防止高频更新导致界面卡死 (每 100ms 最多更新一次)
		if (now - lastUpdateRef.current < 100) return;
		lastUpdateRef.current = now;

		const getLowestAsk = (book) => {
			const asks = book?.asks || [];
			if (asks.length === 0) return null;
			const sortedAsks = [...asks].sort((a, b) => Number(a.price) - Number(b.price));
			return Number(sortedAsks[0].price);
		};

		const timeStr = formatOccurrenceTime(now);
		const current15mTs = getCurrent15MinWindowTimestamp();

		// 通用的策略分析逻辑
		const updateStrategy = (asset, direction, price, winTs, isStopBuyPhase, isLiquidationPhase) => {
			if (price === null) return;

			const strategyKey = `${asset}_${direction}`;
			const pendingEvent = strategyEventsRef.current[strategyKey];

			// 1. 如果处于“探测卖出机会阶段” (状态 B)
			if (pendingEvent) {
				const isTakeProfit = price >= pendingEvent.buyPrice + 0.05;
				const isStopLoss = price <= pendingEvent.buyPrice - 0.05;

				if (isTakeProfit || isStopLoss || isLiquidationPhase) {
					appendStrategyAnalysisToCSV({
						...pendingEvent,
						sellTime: timeStr,
						sellPrice: price,
						status: isLiquidationPhase ? 'FORCE_CLEAR' : (isTakeProfit ? 'TAKE_PROFIT' : 'STOP_LOSS')
					});
					delete strategyEventsRef.current[strategyKey]; // 回到状态 A
				}
				return;
			}

			// 2. 如果处于“探测买入机会阶段” (状态 A)
			// 如果是“停止买入阶段”或“清仓阶段”，不再探测新的闪崩
			if (isStopBuyPhase || isLiquidationPhase) return;

			// 更新 10s 滑动窗口
			if (!priceWindowsRef.current[strategyKey]) priceWindowsRef.current[strategyKey] = [];
			const window = priceWindowsRef.current[strategyKey];
			window.push({ price, ts: now });
			while (window.length > 0 && window[0].ts < now - 10000) {
				window.shift();
			}

			// 检测闪崩 (10s内跌够0.08)
			if (window.length > 1) {
				const maxPriceObj = window.reduce((max, p) => p.price > max.price ? p : max, window[0]);
				if (maxPriceObj.price - price >= 0.08) {
					strategyEventsRef.current[strategyKey] = {
						windowStart: formatWindowTime(winTs),
						asset,
						direction,
						anchorTime: formatOccurrenceTime(maxPriceObj.ts),
						anchorPrice: maxPriceObj.price,
						buyTime: timeStr,
						buyPrice: price
					};
					// 进入状态 B 后，清除窗口缓存，避免同一波下跌触发多次
					priceWindowsRef.current[strategyKey] = [];
				}
			}
		};

		// 处理单个窗口的逻辑 (15m 或 1h)
		const processWindow = (winTs, type, runStrategy) => {
			const is1h = type === '1h';
			const markets = is1h ? markets1hPoolRef.current[winTs] : marketsPoolRef.current[winTs];
			if (!markets) return;

			const winStartMs = winTs * 1000;
			const elapsed = now - winStartMs;
			
			// 计算窗口参数
			const windowDuration = is1h ? 60 * 60 * 1000 : 15 * 60 * 1000;
			const isStopBuyPhase = !is1h && (elapsed >= windowDuration - 3 * 60 * 1000 && elapsed < windowDuration - 1 * 60 * 1000);
			const isLiquidationPhase = !is1h && (elapsed >= windowDuration - 1 * 60 * 1000);
			
			const isWarmup = elapsed < 0; 
			const isActive = elapsed >= 0 && elapsed < windowDuration;

			if (isWarmup || isActive) {
				ASSETS.forEach(asset => {
					const data = markets[asset];
					if (!data) return;
					const ids = extractTokenIds(data);
					if (!ids) return;

					const pUp = getLowestAsk(currentBooks[ids[0]]);
					const pDown = getLowestAsk(currentBooks[ids[1]]);
					
					// 执行新策略逻辑 (仅在指定窗口运行)
					if (runStrategy) {
						updateStrategy(asset, 'Up', pUp, winTs, isStopBuyPhase, isLiquidationPhase);
						updateStrategy(asset, 'Down', pDown, winTs, isStopBuyPhase, isLiquidationPhase);
					}

					/* 暂时注释掉原有的极值记录功能
					const statsPool = is1h ? singleAssetStats1hPoolRef : singleAssetStatsPoolRef;
					const isMinPeriod = is1h ? true : (elapsed < 5 * 60 * 1000);
					updateExtremes(asset, 'Up', pUp, statsPool.current, winTs, isMinPeriod, true, is1h);
					updateExtremes(asset, 'Down', pDown, statsPool.current, winTs, isMinPeriod, true, is1h);
					*/
				});

				/* 暂时注释掉原有的组合最小值记录功能
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
				*/
			}

			/* 暂时注释掉原有的保存逻辑
			if (isSavePeriod && !hasSavedPoolRef.current[winTs]) {
				// 之前的保存逻辑已移出
			}
			*/
		};

		// 遍历所有活跃窗口进行处理
		const active15mWindows = Object.keys(marketsPoolRef.current)
			.map(Number)
			.sort((a, b) => a - b);
		
		// 策略逻辑只针对当前最活跃的 15m 窗口运行一次
		// 这样可以避免多个窗口（如当前和下一个）并行处理时导致策略重复触发
		const primaryWinTs = active15mWindows.find(ts => {
			const elapsed = now - ts * 1000;
			return elapsed >= 0 && elapsed < 15 * 60 * 1000;
		}) || active15mWindows[0];

		active15mWindows.forEach(ts => processWindow(ts, '15m', ts === primaryWinTs));
		Object.keys(markets1hPoolRef.current).forEach(ts => processWindow(parseInt(ts), '1h', false));

		// 统一触发一次界面渲染
		if (minPricesPoolRef.current[current15mTs]) {
			setMinPrices({ ...minPricesPoolRef.current[current15mTs] });
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
