import React, {useState, useEffect, useRef} from 'react';
import {Box, Text} from 'ink';
import {Worker} from 'worker_threads';
import path from 'path';
import {fileURLToPath} from 'url';
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
	getCurrent1hWindowTimestamp,
	get1hMarketSlug,
} from './utils.js';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export default function App({ instances = [] }) {
	const [status, setStatus] = useState('Initializing...');
	const [books, setBooks] = useState({});
	const [countdown, setCountdown] = useState('');
	const [workerStates, setWorkerStates] = useState({}); // { [workerId]: statusInfo }
	
	const workersRef = useRef({}); // { [workerId]: WorkerInstance }
	const marketsPoolRef = useRef({});
	const markets1hPoolRef = useRef({});
	const activeTokensRef = useRef(new Set());
	const clientRef = useRef(null);
	const lastUpdateRef = useRef(0);

	// 启动 Worker 线程
	useEffect(() => {
		instances.forEach(inst => {
			const workerPath = path.resolve(__dirname, 'worker.js');
			const worker = new Worker(workerPath, {
				workerData: {
					id: inst.id,
					config: inst.params,
					asset: inst.asset,
					output: inst.output || 'rebound.csv'
				}
			});

			worker.on('message', (msg) => {
				if (msg.type === 'HEARTBEAT' || msg.type === 'POSITION_OPENED' || msg.type === 'TRADE_COMPLETED') {
					setWorkerStates(prev => ({
						...prev,
						[inst.id]: {
							...prev[inst.id],
							...msg.payload,
							lastUpdate: Date.now()
						}
					}));
				}
			});

			worker.on('error', (err) => {
				console.error(`Worker ${inst.id} error:`, err);
			});

			workersRef.current[inst.id] = worker;
		});

		return () => {
			Object.values(workersRef.current).forEach(w => w.terminate());
		};
	}, [instances]);

	// 行情分发逻辑
	const distributePrices = (currentBooks) => {
		const now = Date.now();
		if (now - lastUpdateRef.current < 100) return;
		lastUpdateRef.current = now;

		const getLowestAsk = (book) => {
			const asks = book?.asks || [];
			if (asks.length === 0) return { price: null, size: null };
			const sortedAsks = [...asks].sort((a, b) => Number(a.price) - Number(b.price));
			return { price: Number(sortedAsks[0].price), size: Number(sortedAsks[0].size) };
		};

		const winTs = getCurrent15MinWindowTimestamp();
		const elapsed = now - winTs * 1000;
		const windowDuration = 15 * 60 * 1000;
		const isStopBuyPhase = elapsed >= windowDuration - 3 * 60 * 1000 && elapsed < windowDuration - 1 * 60 * 1000;
		const isLiquidationPhase = elapsed >= windowDuration - 1 * 60 * 1000;

		// 遍历所有实例，分发对应币种的价格
		instances.forEach(inst => {
			const worker = workersRef.current[inst.id];
			if (!worker) return;

			const markets = marketsPoolRef.current[winTs];
			if (!markets || !markets[inst.asset]) return;

			const tokenIds = extractTokenIds(markets[inst.asset]);
			if (!tokenIds) return;

			const upInfo = getLowestAsk(currentBooks[tokenIds[0]]);
			const downInfo = getLowestAsk(currentBooks[tokenIds[1]]);

			worker.postMessage({
				type: 'TICK',
				payload: {
					priceUp: upInfo.price,
					sizeUp: upInfo.size,
					priceDown: downInfo.price,
					sizeDown: downInfo.size,
					winTs,
					now,
					isStopBuyPhase,
					isLiquidationPhase
				}
			});
		});
	};

	// WebSocket & 市场初始化 (保留原有 initMarkets 逻辑并适配)
	useEffect(() => {
		async function initMarkets() {
			try {
				const current15m = getCurrent15MinWindowTimestamp();
				const next15m = getNext15MinWindowTimestamp();
				const current1h = getCurrent1hWindowTimestamp();
				const next1h = current1h + 3600;

				const windowsToLoad = [
					{ ts: current15m, type: '15m' },
					{ ts: next15m, type: '15m' },
					{ ts: current1h, type: '1h' },
					{ ts: next1h, type: '1h' }
				];

				const newTokens = [];
				for (const win of windowsToLoad) {
					const pool = win.type === '15m' ? marketsPoolRef : markets1hPoolRef;
					if (!pool.current[win.ts]) {
						pool.current[win.ts] = {};
						for (const asset of ASSETS) {
							const slug = win.type === '15m' ? buildMarketSlug(asset, win.ts) : get1hMarketSlug(asset, win.ts);
							try {
								setStatus(`Fetching ${asset} ${win.ts}...`);
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
							} catch (err) {}
						}
					}
				}

				if (!clientRef.current) {
					const client = new ClobMarketClient();
					clientRef.current = client;
					client.on('connected', () => {
						setStatus('Connected');
						if (activeTokensRef.current.size > 0) client.subscribe(Array.from(activeTokensRef.current));
					});
					client.onBook(event => {
						setBooks(prev => {
							const next = { ...prev, [event.asset_id]: { bids: event.bids || [], asks: event.asks || [] } };
							distributePrices(next);
							return next;
						});
					});
					client.onPriceChange(event => {
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
							distributePrices(next);
							return next;
						});
					});
					await client.connect();
				} else if (newTokens.length > 0) {
					clientRef.current.subscribe(newTokens);
				}
				setTimeout(initMarkets, getMsUntilNextWindow() + 2000);
			} catch (err) {
				setTimeout(initMarkets, 5000);
			}
		}

		const countdownInterval = setInterval(() => {
			const seconds = Math.floor(getMsUntilNextWindow() / 1000);
			setCountdown(`${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`);
		}, 1000);

		initMarkets();
		return () => {
			if (clientRef.current) clientRef.current.disconnect();
			clearInterval(countdownInterval);
		};
	}, []);

	return (
		<Box flexDirection="column" padding={1}>
			<Box justifyContent="space-between" borderStyle="single" paddingX={1}>
				<Text bold color="green">Polymarket Rebound Bot (Multi-Threaded)</Text>
				<Text>Status: <Text color="yellow">{status}</Text> | Next Window: <Text color="cyan">{countdown}</Text></Text>
			</Box>

			<Box flexDirection="row" marginTop={1}>
				<Box flexDirection="column" width="40%" borderStyle="round" paddingX={1}>
					<Text bold underline>Strategy Instances</Text>
					{instances.map(inst => {
						const state = workerStates[inst.id] || {};
						return (
							<Box key={inst.id} flexDirection="column" marginBottom={1}>
								<Text bold color="cyan">{inst.id} ({inst.asset})</Text>
								<Text dimColor>  Params: w:{inst.params.window} d:{inst.params.drop} tp:{inst.params.tp} sl:{inst.params.sl}</Text>
								<Text dimColor>  Output: {inst.output || 'rebound.csv'}</Text>
								<Text>  Status: {state.hasUpPosition || state.hasDownPosition ? <Text color="red">POSITION HOLDING</Text> : <Text color="green">SCANNING</Text>}</Text>
								{state.buyPrice && <Text color="magenta">  Last Buy: {state.buyPrice} (Anchor: {state.anchorPrice})</Text>}
							</Box>
						);
					})}
				</Box>

				<Box flexDirection="column" width="60%" marginLeft={2}>
					<Text bold underline>Active Markets</Text>
					{ASSETS.map(asset => (
						<AssetSection 
							key={asset} 
							asset={asset} 
							marketData={marketsPoolRef.current[getCurrent15MinWindowTimestamp()]?.[asset]} 
							books={books} 
						/>
					))}
				</Box>
			</Box>
		</Box>
	);
}
