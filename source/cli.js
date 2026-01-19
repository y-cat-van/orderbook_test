#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import fs from 'fs';
import path from 'path';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ polymarket-orderbook-watcher

	Options
	  --instances, -i   配置文件路径 (JSON)
	  --window, -w      闪崩监测时间窗口 (秒，默认: 10)
	  --drop, -d        触发买入的跌幅阈值 (默认: 0.08)
	  --tp, -t          止盈距离 (默认: 0.05)
	  --sl, -s          止损距离 (默认: 0.05)
	  --asset, -a       交易币种 (默认: BTC, 仅在未提供 --instances 时有效)

	Description
	  Real-time multi-threaded rebound bot for Polymarket.
	  Supports multiple strategy instances via config file or single instance via flags.

	Examples
	  $ polymarket-orderbook-watcher --instances ./instances.json
	  $ polymarket-orderbook-watcher --window 15 --drop 0.1 --tp 0.06 --sl 0.04 --asset SOL
`,
	{
		importMeta: import.meta,
		flags: {
			instances: {
				type: 'string',
				shortFlag: 'i'
			},
			window: {
				type: 'number',
				shortFlag: 'w',
				default: 10
			},
			drop: {
				type: 'number',
				shortFlag: 'd',
				default: 0.08
			},
			tp: {
				type: 'number',
				shortFlag: 't',
				default: 0.05
			},
			sl: {
				type: 'number',
				shortFlag: 's',
				default: 0.05
			},
			asset: {
				type: 'string',
				shortFlag: 'a',
				default: 'BTC'
			}
		}
	},
);

let instances = [];

if (cli.flags.instances) {
	try {
		const configPath = path.resolve(process.cwd(), cli.flags.instances);
		const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		instances = configData.instances || [];
	} catch (err) {
		console.error('Error loading instances config:', err.message);
		process.exit(1);
	}
} else {
	// Fallback to single instance from flags
	instances = [
		{
			id: `default-${cli.flags.asset}`,
			asset: cli.flags.asset.toUpperCase(),
			params: {
				window: cli.flags.window,
				drop: cli.flags.drop,
				tp: cli.flags.tp,
				sl: cli.flags.sl
			},
			output: `rebound_${cli.flags.asset.toLowerCase()}.csv`
		}
	];
}

render(<App instances={instances} />);
