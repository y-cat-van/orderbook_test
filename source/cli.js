#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ polymarket-orderbook-watcher

	Options
	  --window, -w      闪崩监测时间窗口 (秒，默认: 10)
	  --drop, -d        触发买入的跌幅阈值 (默认: 0.08)
	  --tp, -t          止盈距离 (默认: 0.05)
	  --sl, -s          止损距离 (默认: 0.05)

	Description
	  Real-time orderbook viewer for Polymarket BTC Up/Down 15-minute markets.
	  Automatically switches to the next market window every 15 minutes.

	Examples
	  $ polymarket-orderbook-watcher --window 15 --drop 0.1 --tp 0.06 --sl 0.04
`,
	{
		importMeta: import.meta,
		flags: {
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
			}
		}
	},
);

render(
	<App
		config={{
			flashWindow: cli.flags.window,
			dropThreshold: cli.flags.drop,
			tpDistance: cli.flags.tp,
			slDistance: cli.flags.sl
		}}
	/>
);
