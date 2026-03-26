import * as cheerio from 'cheerio';
async function fetchNaverPrice(symbol) {
    try {
        const code = symbol.replace('.KS', '');
        const res = await fetch(`https://finance.naver.com/item/main.naver?code=${code}`);
        const html = await res.text();
        const $ = cheerio.load(html);
        
        const priceStr = $('.no_today .blind').first().text().replace(/,/g, '');
        const currentPrice = parseInt(priceStr);
        
        const changeStr = $('.no_exday .blind').first().text().replace(/,/g, '');
        const changeIcon = $('.no_exday .ico').first().text(); // "상승" or "하락"
        const changeVal = parseInt(changeStr);
        
        const prevClose = changeIcon === '상승' ? currentPrice - changeVal : currentPrice + changeVal;
        const percent = ((currentPrice - prevClose) / prevClose * 100).toFixed(2);
        
        console.log(`Code: ${code}, Price: ${currentPrice}, Change%: ${percent}%`);
    } catch(e) {
        console.error(e);
    }
    process.exit(0);
}
fetchNaverPrice('005930.KS');
