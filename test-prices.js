import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
async function run() {
    try {
        console.log("Fetching live prices...");
        for (let sym of ['AMD', 'TSLA', 'AAPL', '005930.KS']) {
            const q = await yahooFinance.quote(sym);
            console.log(`${sym}: ${q.regularMarketPrice} (Change: ${q.regularMarketChangePercent?.toFixed(2)}%)`);
        }
    } catch(e) { console.error(e); }
    process.exit(0);
}
run();
