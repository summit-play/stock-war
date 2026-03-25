async function run() {
    try {
        const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/AAPL");
        const data = await res.json();
        const price = data.chart.result[0].meta.regularMarketPrice;
        console.log("Raw Fetch AAPL Price:", price);
    } catch(e) {
        console.error("Fetch Error:", e);
    }
    process.exit(0);
}
run();
