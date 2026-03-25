async function run() {
    try {
        const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/AMD");
        const data = await res.json();
        const meta = data.chart.result[0].meta;
        console.log("AMD V8 Chart Meta:");
        console.log("regularMarketPrice:", meta.regularMarketPrice);
        console.log("chartPreviousClose:", meta.chartPreviousClose);
        console.log("Symbol:", meta.symbol);
        
        const change = ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100);
        console.log("Calculated Change %:", change.toFixed(2) + "%");
    } catch(e) {
        console.error("Fetch Error:", e);
    }
    process.exit(0);
}
run();
