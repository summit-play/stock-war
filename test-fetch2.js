async function run() {
    try {
        const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/005930.KS");
        const data = await res.json();
        const meta = data.chart.result[0].meta;
        console.log("005930.KS Price:", meta.regularMarketPrice);
        console.log("Previous Close:", meta.chartPreviousClose);
    } catch(e) {
        console.error("Fetch Error:", e);
    }
    process.exit(0);
}
run();
