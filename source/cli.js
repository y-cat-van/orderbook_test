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
	  --output, -o      输出文件名 (仅在未提供 --instances 时有效)

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
			},
			output: {
				type: 'string',
				shortFlag: 'o'
			}
		}
	},
);

let instances = [];
const defaultInstancesPath = path.resolve(process.cwd(), 'instances.json');

// 检查是否提供了任何策略相关的命令行参数（非默认值）
const hasStrategyFlags = 
	cli.flags.window !== 10 || 
	cli.flags.drop !== 0.08 || 
	cli.flags.tp !== 0.05 || 
	cli.flags.sl !== 0.05 || 
	cli.flags.asset !== 'BTC' ||
	!!cli.flags.output;

// 优先顺序：
// 1. 显式指定了 --instances
// 2. 没有提供任何策略参数，且当前目录下存在 instances.json (自动加载)
// 3. 命令行参数指定的单个币种 (Fallback)
if (cli.flags.instances || (!hasStrategyFlags && fs.existsSync(defaultInstancesPath))) {
	try {
		const configPath = cli.flags.instances 
			? path.resolve(process.cwd(), cli.flags.instances)
			: defaultInstancesPath;
			
		const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		instances = configData.instances || [];
		console.log(`Loaded ${instances.length} instances from ${configPath}`);
	} catch (err) {
		if (cli.flags.instances) {
			console.error('Error loading instances config:', err.message);
			process.exit(1);
		}
		// 如果是默认尝试加载 instances.json 失败（比如格式错误），则回退到单币种模式
	}
}

if (instances.length === 0) {
	// Fallback to single instance from flags
	const asset = cli.flags.asset.toUpperCase();
	instances = [
		{
			id: `default-${asset}`,
			asset: asset,
			params: {
				window: cli.flags.window,
				drop: cli.flags.drop,
				tp: cli.flags.tp,
				sl: cli.flags.sl
			},
			output: cli.flags.output || `rebound_${asset.toLowerCase()}.csv`
		}
	];
}

render(<App instances={instances} />);
