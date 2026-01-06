
import { getCurrent15MinWindowTimestamp, buildMarketSlug, fetchMarketData, extractTokenIds } from './source/utils.js';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'];

async function debug() {
    const timestamp = getCurrent15MinWindowTimestamp();
    console.log('Current Timestamp:', timestamp);
    console.log('Current Date:', new Date(timestamp * 1000).toISOString());

    for (const asset of ASSETS) {
        const slug = buildMarketSlug(asset, timestamp);
        console.log(`\n--- Checking ${asset} ---`);
        console.log(`Slug: ${slug}`);
        try {
            const data = await fetchMarketData(slug);
            console.log(`Successfully fetched ${asset} data`);
            if (data && data.markets && data.markets.length > 0) {
                const rawTokenIds = data.markets[0].clobTokenIds;
                console.log(`Raw clobTokenIds:`, rawTokenIds);
                
                const tokens = extractTokenIds(data);
                console.log(`Extracted tokens:`, tokens);
            } else {
                console.log(`No markets found in data for ${asset}`);
            }
        } catch (err) {
            console.error(`Failed to fetch ${asset}: ${err.message}`);
        }
    }
}

debug();
