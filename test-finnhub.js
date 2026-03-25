async function run() {
    try {
        const res = await fetch("https://finnhub.io/api/v1/quote?symbol=AAPL&token=d71v0d9r01qjeeef8r4gd71v0d9r01qjeeef8r50");
        const data = await res.json();
        console.log("Finnhub Data:", data);
        console.log("Price:", data.c, "Percent Change:", data.dp + "%");
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
run();
