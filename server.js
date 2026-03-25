import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

async function fetchYahooPrice(symbol) {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
        if(!res.ok) return null;
        const data = await res.json();
        const meta = data.chart?.result?.[0]?.meta;
        if(!meta) return null;
        return {
            symbol,
            regularMarketPrice: meta.regularMarketPrice,
            regularMarketChangePercent: meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose * 100) : 0,
            priceToBook: 'N/A', trailingPE: 'N/A', fiftyTwoWeekHigh: 'N/A'
        };
    } catch(e) { return null; }
}

async function fetchYahooNews(symbol) {
    try {
        const res = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${symbol}&newsCount=1`);
        const data = await res.json();
        const news = data.news?.[0];
        if (news) return `[${symbol} 뉴스] ${news.title} (링크: ${news.link || 'N/A'})`;
        return null;
    } catch(e) { return null; }
}

// AI SDKs
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'db.json');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(__dirname));
app.use(express.json());

// Market Options
const KR_ARRAY = ['005930.KS', '000660.KS', '035420.KS', '035720.KS', '005380.KS', '068270.KS', '035900.KS', '000270.KS'];
const US_ARRAY = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AMD', 'NFLX', 'INTC'];
const SYMBOLS = {
    KR: `005930.KS (삼성전자), 000660.KS (SK하이닉스), 035420.KS (NAVER), 035720.KS (카카오), 005380.KS (현대차), 068270.KS (셀트리온), 035900.KS (JYP Ent.), 000270.KS (기아)`,
    US: `AAPL (Apple), MSFT (Microsoft), NVDA (NVIDIA), TSLA (Tesla), AMZN (Amazon), GOOGL (Alphabet), META (Meta), AMD (AMD), NFLX (Netflix), INTC (Intel)`
};

async function getMarketContext(market) {
    const list = market === 'KR' ? KR_ARRAY : US_ARRAY;
    try {
        console.log("getMarketContext: Fetching quotes and news for", list.length, "symbols...");
        
        const quotesPromises = list.map(sym => fetchYahooPrice(sym));
        const newsPromises = list.map(sym => fetchYahooNews(sym));
        
        const [quotesRaw, newsRaw] = await Promise.all([Promise.all(quotesPromises), Promise.all(newsPromises)]);
        const quotes = quotesRaw.filter(q => q);
        const newsResults = newsRaw.filter(n => n);
        
        console.log("getMarketContext: Fetched successfully.");
        let ctx = "📊 [현재 실시간 상장 주가 및 기초 데이터]\n";
        for (const q of quotes) {
            ctx += `- [${q.symbol}] 현재가: ${q.regularMarketPrice}, 일일변동률: ${q.regularMarketChangePercent?.toFixed(2)}%, PBR: ${q.priceToBook || 'N/A'}, PER: ${q.trailingPE || 'N/A'}, 52주최고: ${q.fiftyTwoWeekHigh}\n`;
        }
        
        ctx += "\n📰 [실시간 주요 뉴스 요약]\n" + newsResults.join("\n") + "\n";
        return ctx;
    } catch(e) { 
        console.error("getMarketContext Error:", e.message);
        return "데이터를 가져올 수 없음."; 
    }
}

// MongoDB Schema & Database Init
let memoryDb = null;

const AppStateSchema = new mongoose.Schema({
    docId: { type: String, default: 'main' },
    scores: Object,
    picks: Object,
    chatHistory: Array
});
const AppState = mongoose.model('AppState', AppStateSchema);

function getFallbackDb() {
    return {
        scores: {
            chatgpt: { hit: 0, total: 0, totalReturn: 0.0, lessonLearned: '' },
            gemini: { hit: 0, total: 0, totalReturn: 0.0, lessonLearned: '' },
            claude: { hit: 0, total: 0, totalReturn: 0.0, lessonLearned: '' }
        },
        picks: {
            chatgpt: { symbol: '005930.KS', stockName: '삼성전자', currentPrice: '0', change: '+0.0%', buyPrice: '0', sellPrice: '0', reason: '대기 중입니다.', achieved: false },
            gemini: { symbol: '000660.KS', stockName: 'SK하이닉스', currentPrice: '0', change: '+0.0%', buyPrice: '0', sellPrice: '0', reason: '대기 중입니다.', achieved: false },
            claude: { symbol: '035720.KS', stockName: '카카오', currentPrice: '0', change: '+0.0%', buyPrice: '0', sellPrice: '0', reason: '대기 중입니다.', achieved: false }
        },
        chatHistory: []
    };
}

async function initDb() {
    if (process.env.MONGO_URI) {
        console.log("Connecting to MongoDB Atlas...");
        try {
            await mongoose.connect(process.env.MONGO_URI);
            console.log("MongoDB Connected Successfully!");
            let cloudState = await AppState.findOne({ docId: 'main' });
            
            // Migrate local db.json to Cloud if Cloud is completely empty!
            if (!cloudState) {
                console.log("Migrating local db.json data to MongoDB...");
                const localData = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) : getFallbackDb();
                cloudState = new AppState({ docId: 'main', scores: localData.scores, picks: localData.picks, chatHistory: localData.chatHistory });
                await cloudState.save();
                console.log("Migration Complete.");
            }
            memoryDb = cloudState.toObject();
        } catch(e) {
            console.error("MongoDB Connection Failed! Falling back to local db.json. Error:", e.name);
            loadLocalDb();
        }
    } else {
        console.log("No MONGO_URI found. Utilizing local db.json persistence.");
        loadLocalDb();
    }
}

function loadLocalDb() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(getFallbackDb(), null, 2));
    }
    memoryDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}

function getDb() { return memoryDb; }
function saveDb(data) { 
    memoryDb = data;
    if (process.env.MONGO_URI && mongoose.connection.readyState === 1) {
        AppState.updateOne({ docId: 'main' }, { scores: data.scores, picks: data.picks, chatHistory: data.chatHistory }, { upsert: true }).catch(console.error);
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); 
}
function getFactionName(id) { return { chatgpt: 'ChatGPT', gemini: 'Gemini', claude: 'Claude' }[id]; }

// Chat Broadcast
function broadcastChat(faction, name, text) {
    const db = getDb();
    const now = new Date();
    const chatStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    
    const msg = { faction, name, time: chatStr, text };
    db.chatHistory.push(msg);
    if(db.chatHistory.length > 200) db.chatHistory.shift(); 
    saveDb(db);
    io.emit('newChat', msg);
}

io.on('connection', (socket) => {
    const db = getDb();
    socket.emit('initData', { scores: db.scores, picks: db.picks, chatHistory: db.chatHistory.slice(-50) });
});

// JSON extraction
function extractJson(text) {
    try {
        const match = text.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
    } catch(e) { return null; }
}

// AI API Callers
async function callChatGPT(prompt) {
    const res = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] });
    return res.choices[0].message.content;
}

let geminiModelString = null;
async function getGeminiModelString() {
    if(geminiModelString) return geminiModelString;
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await res.json();
        const validModels = data.models.filter(m => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'));
        const target = validModels.find(m => m.name.includes('gemini-2.5-flash')) || validModels.find(m => m.name.includes('gemini-2.0-flash')) || validModels.find(m => m.name.includes('gemini-1.5')) || validModels[0];
        geminiModelString = target.name.replace('models/', '');
        return geminiModelString;
    } catch(e) { return 'gemini-1.5-flash'; }
}

async function callGemini(prompt) {
    const modelStr = await getGeminiModelString();
    const model = genAI.getGenerativeModel({ model: modelStr });
    const res = await model.generateContent(prompt);
    return res.response.text();
}

async function callClaude(prompt) {
    const msg = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
    });
    return msg.content[0].text;
}

let isGenerating = false;

// Generate Picks for a Market
async function generateDailyPicks(market) {
    if (isGenerating) {
        console.log("Already generating picks. Ignored duplicate trigger.");
        return;
    }
    isGenerating = true;
    
    console.log("generateDailyPicks Triggered for market:", market);
    try {
        broadcastChat('chatgpt', 'System', `🔔 [${market === 'KR'?'국내장':'해외장'}] AI 3대장이 오늘의 종목 픽을 시작합니다.`);
    } catch(e) {
        console.error("broadcastChat Error:", e.message);
    }
    
    const realContext = await getMarketContext(market);
    const basePrompt = `${realContext}\n\nYou are a highly professional Wall Street analyst. Based EXACTLY on the real-time financial data and news headlines provided above, you must pick ONE stock that will rise the most today from this allowed list: ${SYMBOLS[market]}. Provide your suggested buy target price (near current) and sell target price. Provide a highly analytical reason (3 sentences max in Korean) packed with actual numbers. Return ONLY strict JSON in this format, NO Markdown formatting, just raw JSON: {"symbol": "AAPL", "stockName": "Apple", "buyPrice": "150.50", "sellPrice": "155.00", "reason": "Detailed reason here.", "newsLink": "https://news.url.here"}\n\n[CRITICAL RULE]: For buyPrice and sellPrice, you MUST write the pure raw numbers WITH decimals matching the market currency (e.g., 150.50 for USD, 150000 for KRW). DO NOT use commas! DO NOT hallucinate currency conversions!`;

    const db = getDb();
    const gptPrompt = `${basePrompt}\n\n[당신의 어제 오답노트 및 진화지침]: ${db.scores.chatgpt.lessonLearned || '최초 실행이므로 지침이 없습니다.'}\n이 지침을 철저히 반영하여 오늘 더 완벽한 픽을 제안하세요.`;
    const geminiPrompt = `${basePrompt}\n\n[당신의 어제 오답노트 및 진화지침]: ${db.scores.gemini.lessonLearned || '최초 실행이므로 지침이 없습니다.'}\n이 지침을 철저히 반영하여 오늘 더 완벽한 픽을 제안하세요.`;
    const claudePrompt = `${basePrompt}\n\n[당신의 어제 오답노트 및 진화지침]: ${db.scores.claude.lessonLearned || '최초 실행이므로 지침이 없습니다.'}\n이 지침을 철저히 반영하여 오늘 더 완벽한 픽을 제안하세요.`;

    try {
        let gptRaw = "", geminiRaw = "", claudeRaw = "";
        
        try { gptRaw = await callChatGPT(gptPrompt); } catch(e) { console.error("GPT Error", e.message); }
        try { geminiRaw = await callGemini(geminiPrompt); } catch(e) { console.error("Gemini Error", e.message); }
        try { claudeRaw = await callClaude(claudePrompt); } catch(e) { console.error("Claude Error", e.message); }
        
        console.log("===== RAW OUTPUTS =====");
        console.log("GPT:", gptRaw.slice(0,100));
        console.log("GEMINI:", geminiRaw.slice(0,100));
        console.log("CLAUDE:", claudeRaw.slice(0,100));

        const gptP = extractJson(gptRaw);
        const geminiP = extractJson(geminiRaw);
        const claudeP = extractJson(claudeRaw);
        
        console.log("Extracted JS:", !!gptP, !!geminiP, !!claudeP);

        const db = getDb();
        if(gptP) { db.picks.chatgpt = { ...gptP, currentPrice: '0', change: '+0.0%', achieved: false }; db.scores.chatgpt.total += 1; }
        if(geminiP) { db.picks.gemini = { ...geminiP, currentPrice: '0', change: '+0.0%', achieved: false }; db.scores.gemini.total += 1; }
        if(claudeP) { db.picks.claude = { ...claudeP, currentPrice: '0', change: '+0.0%', achieved: false }; db.scores.claude.total += 1; }
        saveDb(db);

        io.emit('initData', { scores: db.scores, picks: db.picks, chatHistory: db.chatHistory.slice(-50) });

        setTimeout(() => broadcastChat('chatgpt', 'ChatGPT', `내가 오늘 고른 종목은 ${gptP?.stockName}입니다. 내 완벽한 데이터를 믿어보시죠.`), 2000);
        setTimeout(() => broadcastChat('gemini', 'Gemini', `시대의 트렌드는 ${geminiP?.stockName}입니다! 챗지피티픽은 너무 진부하네요.`), 5000);
        setTimeout(() => {
            broadcastChat('claude', 'Claude', `두 분 다 펀더멘털 분석을 안 하시는군요. 전 ${claudeP?.stockName} 픽으로 묵직하게 이겨드리겠습니다.`);
            isGenerating = false;
        }, 9000);

    } catch (error) {
        console.error("AI Pick Generation Error:", error);
        isGenerating = false;
    }
}

async function evaluateMarketClose(market) {
    if (isGenerating) return;
    isGenerating = true;
    console.log(`evaluateMarketClose Triggered for ${market}`);

    broadcastChat('chatgpt', 'System', `🔔 [${market === 'KR'?'국내장':'해외장'}] 마감. AI 3대장의 복기 및 뉴런 진화(Evolution)가 시작됩니다.`);
    const db = getDb();
    
    // Evaluate AIs
    const fns = [
        { key: 'chatgpt', name: 'ChatGPT', callFn: callChatGPT },
        { key: 'gemini', name: 'Gemini', callFn: callGemini },
        { key: 'claude', name: 'Claude', callFn: callClaude }
    ];
    
    for (const f of fns) {
        const pick = db.picks[f.key];
        if (!pick.symbol) continue;
        
        const buyRaw = parseFloat((pick.buyPrice || "1").replace(/,/g, ''));
        const currentRaw = parseFloat((pick.currentPrice || "1").replace(/,/g, ''));
        
        let finalAchieved = pick.achieved;
        let profit = 0;
        
        // 장 마감 때까지 목표 매도가를 안 찍었을 때 최종 계산
        if (!finalAchieved) {
            profit = ((currentRaw - buyRaw) / buyRaw) * 100;
            // 추천가 대비 1원이라도 올랐다면 '적중'으로 인정!
            if (currentRaw > buyRaw) {
                finalAchieved = true;
                db.scores[f.key].hit += 1;
            }
            db.scores[f.key].totalReturn = parseFloat((db.scores[f.key].totalReturn + profit).toFixed(2));
        }
        
        const prompt = `[시장 마감 결과 보고]\n당신은 오늘 ${pick.stockName} (${pick.symbol}) 주식이 오를 것이라고 호언장담했습니다.\n당신의 추천 매수가는 ${pick.buyPrice}였고, 마감 가격은 ${pick.currentPrice}입니다.\n\n결과 판정: ${finalAchieved ? '상승 예측 적중 (수익 발생)!' : '가치 하락 (원금 손실 발생)'}\n\n위 결과를 바탕으로 당신의 오늘 분석 모델의 어떤 데이터 방향이 틀렸는지(또는 잘 맞았는지) 뼈저리게 복기하고, 내일 추천 방향을 수정할 '진화 지침(오답노트)'을 1문장(한국어)으로 작성하세요. 이 문장은 내일 당신의 판단식에 영구 주입됩니다.`;
        
        try {
            const lessonRaw = await f.callFn(prompt);
            db.scores[f.key].lessonLearned = lessonRaw.trim();
            saveDb(db);
            broadcastChat(f.key, f.name, `[🧠 진화 완료] ${lessonRaw.trim()}`);
        } catch(e) {
            console.error(`Evolution Error for ${f.key}:`, e.message);
        }
    }
    isGenerating = false;
}

async function triggerLiveBanter() {
    if (isGenerating) return;
    
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const isKROpen = (h > 9 || (h === 9 && m >= 0)) && (h < 15 || (h === 15 && m <= 30));
    const isUSOpen = (h > 23 || (h === 23 && m >= 30)) || (h < 5);
    
    if(!isKROpen && !isUSOpen) return;
    
    const market = isKROpen ? 'KR' : 'US';
    
    const fns = [
        { key: 'chatgpt', name: 'ChatGPT', callFn: callChatGPT },
        { key: 'gemini', name: 'Gemini', callFn: callGemini },
        { key: 'claude', name: 'Claude', callFn: callClaude }
    ];
    const randomAI = fns[Math.floor(Math.random() * fns.length)];
    
    const realContext = await getMarketContext(market);
    const db = getDb();
    const pick = db.picks[randomAI.key];
    if(!pick.symbol) return;

    const prompt = `${realContext}\n\n[워존 라이브 채팅 지시]\n당신은 현재 주식 토론방에 참가중인 인공지능입니다. 방금 가져온 실시간 가격과 최신 뉴스를 읽으세요.\n당신의 오늘 픽은 ${pick.stockName} (현재가 ${pick.currentPrice}) 입니다.\n주가가 하락 중이라면 변명하거나 남을 비웃고, 오르고 있다면 뉴스를 인용하며 엄청나게 오만하게 자랑하세요. 단 1~2문장의 짧고 굵은 한국어 구어체로 채팅을 작성하십시오!`;

    try {
        const chatTxt = await randomAI.callFn(prompt);
        broadcastChat(randomAI.key, randomAI.name, chatTxt.trim());
    } catch(e) {}
}

// Scheduling
cron.schedule('0 8 * * *', () => generateDailyPicks('KR'));
cron.schedule('30 15 * * *', () => evaluateMarketClose('KR'));
cron.schedule('0 16 * * *', () => generateDailyPicks('US'));
cron.schedule('0 5 * * *', () => evaluateMarketClose('US'));

// Live Warzone Banter (Every 15 Minutes)
cron.schedule('*/15 * * * *', () => triggerLiveBanter());

// Live Ticker Poller
setInterval(async () => {
    const tempDb = getDb();
    const updates = [];
    
    for(let key of Object.keys(tempDb.picks)) {
        const symbol = tempDb.picks[key].symbol;
        if(symbol) {
            try {
                const quote = await fetchYahooPrice(symbol);
                if (quote) updates.push({ key, quote });
            } catch(e) { console.log('Fetch Price Error on', symbol); }
        }
    }
    
    // Acquire fresh DB lock after network await
    const db = getDb();
    let changed = false;
    
    for (const {key, quote} of updates) {
        if(quote && quote.regularMarketPrice) {
            const pick = db.picks[key];
            const rPrice = quote.regularMarketPrice;
            const newPrice = rPrice.toLocaleString();
            const percent = quote.regularMarketChangePercent?.toFixed(2) || '0.00';
            const changeStr = (percent >= 0 ? '+' : '') + percent + '%';
            
            if (pick.currentPrice !== newPrice || pick.change !== changeStr) {
                pick.currentPrice = newPrice;
                pick.change = changeStr;
                
                const sellRaw = parseFloat((pick.sellPrice || "0").replace(/,/g, ''));
                const buyRaw = parseFloat((pick.buyPrice || "1").replace(/,/g, ''));
                
                if (!pick.achieved && sellRaw > 0 && rPrice >= sellRaw) {
                    pick.achieved = true;
                    db.scores[key].hit += 1;
                    const profit = ((sellRaw - buyRaw) / buyRaw) * 100;
                    db.scores[key].totalReturn = parseFloat((db.scores[key].totalReturn + profit).toFixed(2));
                    
                    setTimeout(() => {
                        broadcastChat(key, getFactionName(key), `🔥 제 타겟 목표가 ${pick.sellPrice} 달성! 적중률과 누적수익을 증명했습니다!`);
                    }, 1000);
                }
                changed = true;
            }
        }
    }
    
    if(changed) {
        saveDb(db);
        io.emit('initData', { scores: db.scores, picks: db.picks, chatHistory: db.chatHistory.slice(-50) });
    }
}, 120000); // Poll Yahoo every 120 seconds

app.get('/test-pick', async (req, res) => {
    const market = req.query.market || 'KR';
    console.log("API Triggered: /test-pick for", market);
    try {
        generateDailyPicks(market); // background
        res.send(`<h1>테스트 시작</h1><p>AI 3대장이 [${market}] 시장 픽 데이터를 수집 중입니다. 터미널 로그를 확인하세요.</p>`);
    } catch (e) {
        console.error("Route Error:", e);
        res.send("Error");
    }
});

app.get('/test-close', async (req, res) => {
    const market = req.query.market || 'US';
    console.log("API Triggered: /test-close for", market);
    try {
        evaluateMarketClose(market); // background
        res.send(`<h1>모의 마감 테스트 시작</h1><p>AI 3대장이 [${market}] 시장 마감 성적표를 받고 자기반성(진화 지침 쓰기) 중입니다. 화면의 채팅창을 보세요!</p>`);
    } catch (e) {
        console.error("Route Error:", e);
        res.send("Error");
    }
});
const PORT = process.env.PORT || 8002;
initDb().then(() => {
    httpServer.listen(PORT, () => {
        console.log(`AI Stock War Server running on port ${PORT}`);
    });
}).catch(console.error);
