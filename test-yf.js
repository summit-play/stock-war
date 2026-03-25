import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
yahooFinance.quote('005930.KS').then(res => console.log('SUCCESS:', res.regularMarketPrice)).catch(err => console.error('ERROR:', err.message));
