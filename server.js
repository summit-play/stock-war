import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

async function fetchNaverPrice(symbol) {
    try {
        const code = symbol.replace('.KS', '');
        const res = await fetch(`https://finance.naver.com/item/main.naver?code=${code}`);
        const html = await res.text();
        
        const todayBlock = html.split('class="no_today"')[1];
        if(!todayBlock) return null;
        
        const blindMatch = todayBlock.match(/<span class="blind">([\d,]+)<\/span>/);
        if(!blindMatch) return null;
        const currentPrice = parseInt(blindMatch[1].replace(/,/g, ''));
        
        const exdayBlock = html.split('class="no_exday"')[1];
        const exdayBlind = exdayBlock?.match(/<span class="blind">([\d,]+)<\/span>/);
        const changeVal = exdayBlind ? parseInt(exdayBlind[1].replace(/,/g, '')) : 0;
        
        const isUp = exdayBlock?.includes('상승');
        const prevClose = isUp ? currentPrice - changeVal : currentPrice + changeVal;
        const percent = prevClose ? ((currentPrice - prevClose) / prevClose * 100) : 0;
        
        return {
            symbol,
            regularMarketPrice: currentPrice,
            regularMarketChangePercent: percent,
            priceToBook: 'N/A', trailingPE: 'N/A', fiftyTwoWeekHigh: 'N/A'
        };
    } catch(e) { return null; }
}

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

async function fetchMacroNews(market) {
    try {
        const query = market === 'KR' ? '경제 OR 정치 OR 주식 OR 산업' : 'Economy OR Politics OR "Stock Market" OR Technology OR Policy';
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&language=${market === 'KR'?'ko':'en'}&pageSize=100&apiKey=${process.env.NEWS_API_KEY}`;
        const res = await fetch(url);
        const data = await res.json();
        return data.articles || [];
    } catch(e) {
        return [];
    }
}

async function fetchExchangeRate() {
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/KRW=X`);
        if(!res.ok) return 1400;
        const data = await res.json();
        return data.chart?.result?.[0]?.meta?.regularMarketPrice || 1400;
    } catch(e) { return 1400; }
}

async function fetchFinnhubPrice(symbol) {
    if (!process.env.FINNHUB_API_KEY) return null;
    try {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${process.env.FINNHUB_API_KEY}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.c === 0 && data.pc === 0) return null; // invalid symbol
        return {
            symbol,
            regularMarketPrice: data.c,
            regularMarketChangePercent: data.dp,
            priceToBook: 'N/A', trailingPE: 'N/A', fiftyTwoWeekHigh: 'N/A'
        };
    } catch(e) { return null; }
}

// AI SDKs
import OpenAI from 'openai';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
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
    const news = await fetchMacroNews(market);
    
    let ctx = `📰 [최신 정치/경제 및 시장 주요 뉴스 (총 ${news.length > 0 ? news.length : 100}개)]\n`;
    ctx += "이 뉴스들을 깊이 있게 스터디(Study)하여 현재 어느 섹터나 테마 주식이 오를지 분석하십시오.\n\n";
    
    if (news && news.length > 0) {
        news.forEach((n, i) => {
            ctx += `${i+1}. [${n.title}] - ${n.description || ''}\n`;
        });
    } else {
        ctx += "현재 뉴스 파싱을 대기 중입니다.\n";
    }
    return ctx;
}

// MongoDB Schema & Database Init
let memoryDb = null;

const AppStateSchema = new mongoose.Schema({
    docId: { type: String, default: 'main' },
    scores: Object,
    picks: Object,
    chatHistory: Array
});
const AppState = mongoose.model('AppState', AppStateSchema);function getFallbackDb() {
    return {
        scores: {
            chatgpt: { hit: 0, total: 0, totalReturn: 0.0, lessonLearned: '', balance: 10000000, loanAmount: 0, ledger: [] },
            gemini: { hit: 0, total: 0, totalReturn: 0.0, lessonLearned: '', balance: 10000000, loanAmount: 0, ledger: [] },
            claude: { hit: 0, total: 0, totalReturn: 0.0, lessonLearned: '', balance: 10000000, loanAmount: 0, ledger: [] }
        },
        picks: {
            chatgpt: { symbol: '005930.KS', stockName: '삼성전자', currentPrice: '0', change: '+0.0%', buyPrice: '0', sellPrice: '0', reason: '대기 중입니다.', achieved: false, status: '마감' },
            gemini: { symbol: '000660.KS', stockName: 'SK하이닉스', currentPrice: '0', change: '+0.0%', buyPrice: '0', sellPrice: '0', reason: '대기 중입니다.', achieved: false, status: '마감' },
            claude: { symbol: '035720.KS', stockName: '카카오', currentPrice: '0', change: '+0.0%', buyPrice: '0', sellPrice: '0', reason: '대기 중입니다.', achieved: false, status: '마감' }
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
            migrateSchema(memoryDb);
        } catch(e) {
            console.error("MongoDB Connection Failed! Falling back to local db.json. Error:", e.name);
            loadLocalDb();
        }
    } else {
        console.log("No MONGO_URI found. Utilizing local db.json persistence.");
        loadLocalDb();
    }
}

function migrateSchema(db) {
    let changed = false;
    for (const key of ['chatgpt', 'gemini', 'claude']) {
        if (db.scores[key].balance === undefined) {
            db.scores[key].balance = 10000000;
            db.scores[key].loanAmount = 0;
            db.scores[key].ledger = [];
            changed = true;
        }
    }
    if (changed) saveDb(db);
}

function loadLocalDb() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify(getFallbackDb(), null, 2));
    }
    memoryDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    migrateSchema(memoryDb);
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
        try { return JSON.parse(text.trim()); } catch (e) {}
        
        const mdMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
        if (mdMatch) return JSON.parse(mdMatch[1]);
        
        const start = text.indexOf('{');
        if (start === -1) return null;
        
        let depth = 0;
        for (let i = start; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') {
                depth--;
                if (depth === 0) return JSON.parse(text.substring(start, i + 1));
            }
        }
        return null;
    } catch(e) { return null; }
}

// AI API Callers
async function callChatGPT(prompt) {
    const res = await openai.chat.completions.create({ 
        model: 'gpt-4o-mini', 
        messages: [{ role: 'user', content: prompt }], 
        max_tokens: 1500,
        response_format: { type: "json_object" }
    });
    return res.choices[0].message.content;
}

let geminiModelString = null;
async function getGeminiModelString() {
    if(geminiModelString) return geminiModelString;
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await res.json();
        const validModels = data.models.filter(m => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'));
        if (!validModels || validModels.length === 0) return 'gemini-1.5-flash-latest';
        const target = validModels.find(m => m.name.includes('gemini-2.5-flash')) || validModels.find(m => m.name.includes('gemini-2.0-flash')) || validModels.find(m => m.name.includes('gemini-1.5')) || validModels[0];
        if (!target) return 'gemini-1.5-flash-latest';
        geminiModelString = target.name.replace('models/', '');
        return geminiModelString;
    } catch(e) { return 'gemini-1.5-flash-latest'; }
}

async function callGemini(prompt) {
    const modelStr = await getGeminiModelString();
    const model = genAI.getGenerativeModel({
        model: modelStr,
        generationConfig: { 
            maxOutputTokens: 1500, 
            responseMimeType: "application/json",
            responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                    symbol: { type: SchemaType.STRING },
                    stockName: { type: SchemaType.STRING },
                    buyPrice: { type: SchemaType.STRING },
                    sellPrice: { type: SchemaType.STRING },
                    reason: { type: SchemaType.STRING },
                    newsLink: { type: SchemaType.STRING }
                },
                required: ["symbol", "stockName", "buyPrice", "sellPrice", "reason", "newsLink"]
            }
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
    });
    const res = await model.generateContent(prompt);
    return res.response.text();
}

async function callClaude(prompt) {
    const msg = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 1500,
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
        broadcastChat('system', 'System', `🔔 [${market === 'KR'?'국내장':'해외장'}] AI 3대장이 오늘의 종목 픽을 시작합니다.`);
    } catch(e) { console.error("broadcastChat Error:", e.message); }
    
    const realContext = await getMarketContext(market);
    const db = getDb();
    
    const krwRate = market === 'US' ? await fetchExchangeRate() : 1;

    const basePrompt = `${realContext}\n\nYou are a highly professional Wall Street analyst managing a virtual hedge fund.
[STEP 1]: Study the massive political and economic news headlines provided above. Analyze which industry sector or theme will rise today based on this macro environment.
[STEP 2]: Based on your analysis, freely pick ONE EXACT stock from the ENTIRE ${market === 'KR'?'Korean (KOSPI/KOSDAQ)':'US (NYSE/NASDAQ)'} market that best fits this booming sector.
Your current account balance is: [CURRENT_BALANCE] KRW.
Provide a suggested buy target price (near current) and sell target price. Provide a highly analytical reason (3 sentences max in Korean) explaining YOUR macro analysis and why this specific stock was chosen.
Return ONLY strict JSON in this format, NO Markdown formatting, just raw JSON: 
{"symbol": "${market === 'KR'?'005930.KS':'AAPL'}", "stockName": "Apple", "buyPrice": "150.50", "sellPrice": "155.00", "reason": "Detailed reason here.", "newsLink": "https://news.url.here"}

[CRITICAL RULE]: 
1. The "symbol" MUST be the exact official ticker. ${market === 'KR' ? 'You are trading in KOREA. You MUST pick a 6-digit KR code followed by .KS (e.g., 005930.KS, 000660.KS). Do NOT pick US companies like AAPL.' : 'You are trading in the US. You MUST pick a valid US ticker like AAPL, TSLA, NVDA. Do NOT add .KS and do NOT pick Korean companies.'} If you output a wrong symbol, the system crashes!
2. For buyPrice and sellPrice, you MUST return purely numerical digits (e.g. ${market==='KR'?'185000':'150.50'}). NEVER USE COMMAS (,). NEVER USE SYMBOLS.
`;

    const gptBal = (db.scores.chatgpt.balance || 0).toLocaleString();
    const geminiBal = (db.scores.gemini.balance || 0).toLocaleString();
    const claudeBal = (db.scores.claude.balance || 0).toLocaleString();

    const gptPrompt = basePrompt.replace('[CURRENT_BALANCE]', gptBal) + `\n\n[당신의 고유 투자 철학]: 당신은 매우 **공격적인 모멘텀 투자자(Momentum)**입니다. 현재 시장에서 가장 뜨겁고 변동성이 큰 주도주에 과감하게 배팅하세요.\n[당신의 어제 오답노트 및 진화지침]: ${db.scores.chatgpt.lessonLearned || '없음'}\n이 철학과 지침을 철저히 반영하여 오늘 완벽한 픽을 제안하세요.`;
    const geminiPrompt = basePrompt.replace('[CURRENT_BALANCE]', geminiBal) + `\n\n[당신의 고유 투자 철학]: 당신은 기업의 내재가치를 중시하는 **가치 투자자(Value)**입니다. 뉴스를 분석하여 현재 저평가되었거나 펀더멘털이 가장 튼튼한 묵직한 우량주를 골라내세요.\n[당신의 어제 오답노트 및 진화지침]: ${db.scores.gemini.lessonLearned || '없음'}\n이 철학과 지침을 철저히 반영하여 오늘 완벽한 픽을 제안하세요.`;
    const claudePrompt = basePrompt.replace('[CURRENT_BALANCE]', claudeBal) + `\n\n[당신의 고유 투자 철학]: 당신은 남들과 반대로 움직이는 **역발상 투자자(Contrarian)**입니다. 시장이 열광하는 뻔한 주도주를 피하고, 과도하게 소외되었거나 방어력이 뛰어난 종목을 발굴하세요.\n[당신의 어제 오답노트 및 진화지침]: ${db.scores.claude.lessonLearned || '없음'}\n이 철학과 지침을 철저히 반영하여 오늘 완벽한 픽을 제안하세요.`;

    try {
        let gptRaw = "", geminiRaw = "", claudeRaw = "";
        try { gptRaw = await callChatGPT(gptPrompt); } catch(e) { gptRaw = JSON.stringify({symbol:"",stockName:"[GPT 에러]",buyPrice:"0",sellPrice:"0",reason:e.message.substring(0,250)}); }
        try { geminiRaw = await callGemini(geminiPrompt); } catch(e) { geminiRaw = JSON.stringify({symbol:"",stockName:"[Gemini 에러]",buyPrice:"0",sellPrice:"0",reason:e.message.substring(0,250)}); }
        try { claudeRaw = await callClaude(claudePrompt); } catch(e) { claudeRaw = JSON.stringify({symbol:"",stockName:"[Claude 에러]",buyPrice:"0",sellPrice:"0",reason:e.message.substring(0,250)}); }
        
        const gptP = extractJson(gptRaw);
        const geminiP = extractJson(geminiRaw);
        const claudeP = extractJson(claudeRaw);
        
        async function processPick(aiKey, pickPayload, rawResponse) {
            if(!pickPayload || !pickPayload.buyPrice || !pickPayload.sellPrice) {
                const snippet = (rawResponse || "Empty Response").replace(/</g,"&lt;").substring(0,250);
                db.picks[aiKey] = { symbol: '', stockName: '매매 대기', currentPrice: '0', change: '0%', buyPrice: '0', sellPrice: '0', reason: `[파싱 오류] 엔진 원본 응답:\n${snippet}`, achieved: false, market: null, shares: 0, status: '오류' };
                return;
            }
            
            // STRICT MARKET VALIDATION to prevent cross-market exploit of the USD-to-KRW exchange rate 
            if (market === 'KR' && (!pickPayload.symbol || !pickPayload.symbol.endsWith('.KS'))) {
                db.picks[aiKey] = { symbol: '', stockName: '규정 위반 (한국장 이탈)', currentPrice: '0', change: '0%', buyPrice: '0', sellPrice: '0', reason: '국내장 세션에 미국/타국 종목을 제출하여 픽이 무효화되었습니다.', achieved: false, market: null, shares: 0 };
                return;
            }
            if (market === 'US' && (!pickPayload.symbol || pickPayload.symbol.endsWith('.KS'))) {
                db.picks[aiKey] = { symbol: '', stockName: '규정 위반 (미국장 이탈)', currentPrice: '0', change: '0%', buyPrice: '0', sellPrice: '0', reason: '해외장 세션에 국내 종목을 제출하여 픽이 무효화되었습니다.', achieved: false, market: null, shares: 0 };
                return;
            }
            
            let buyPriceRaw = parseFloat(String(pickPayload.buyPrice).replace(/,/g, ''));
            const sellPriceRaw = parseFloat(String(pickPayload.sellPrice).replace(/,/g, ''));
            
            if (isNaN(buyPriceRaw) || buyPriceRaw <= 0 || isNaN(sellPriceRaw) || sellPriceRaw <= buyPriceRaw) {
                console.error(`Invalid Payload Prices for ${aiKey}:`, pickPayload);
                db.picks[aiKey] = { symbol: '', stockName: '매매 대기', currentPrice: '0', change: '0%', buyPrice: '0', sellPrice: '0', reason: '가격 산정 오류(목표가 미달)로 데이터 갱신 대기 중입니다.', achieved: false, market: null, shares: 0, status: '오류' };
                return;
            }
            
            db.picks[aiKey] = { 
                ...pickPayload, 
                currentPrice: '0', change: '+0.0%', achieved: false,
                shares: 0, investedKRW: 0, buyPriceRaw: 0, market: market, 
                status: '대기중', finalProfitAmt: 0, finalProfitPercent: 0, lessonLearned: ''
            };
        }
        
        await processPick('chatgpt', gptP, gptRaw);
        await processPick('gemini', geminiP, geminiRaw);
        await processPick('claude', claudeP, claudeRaw);
        saveDb(db);

        io.emit('initData', { scores: db.scores, picks: db.picks, chatHistory: db.chatHistory.slice(-50) });

        setTimeout(() => broadcastChat('chairman', '의장 (Chairman)', `🔔 [${market === 'KR'?'한국장':'미국장'} 개장] AI 3대장의 포트폴리오 매수가 승인되었습니다. (적용환율: ${market==='US'?krwRate.toLocaleString()+'원/불':'1:1'})`), 2000);
        
        setTimeout(() => {
            if(gptP) broadcastChat('chairman', '의장 (Chairman)', `[ChatGPT] ${gptP.stockName}(${gptP.symbol}) | 목표가: ${gptP.buyPrice} | 매수: ${db.picks.chatgpt.shares}주 | 투자금: ${Math.round(db.picks.chatgpt.investedKRW).toLocaleString()}₩`);
        }, 5000);
        setTimeout(() => {
            if(geminiP) broadcastChat('chairman', '의장 (Chairman)', `[Gemini] ${geminiP.stockName}(${geminiP.symbol}) | 목표가: ${geminiP.buyPrice} | 매수: ${db.picks.gemini.shares}주 | 투자금: ${Math.round(db.picks.gemini.investedKRW).toLocaleString()}₩`);
        }, 8000);
        setTimeout(() => {
            if(claudeP) broadcastChat('chairman', '의장 (Chairman)', `[Claude] ${claudeP.stockName}(${claudeP.symbol}) | 목표가: ${claudeP.buyPrice} | 매수: ${db.picks.claude.shares}주 | 투자금: ${Math.round(db.picks.claude.investedKRW).toLocaleString()}₩`);
            isGenerating = false;
        }, 11000);

    } catch (error) {
        console.error("AI Pick Generation Error:", error);
        isGenerating = false;
    }
}

async function executeMarketOpen(market) {
    const db = getDb();
    const krwRate = market === 'US' ? await fetchExchangeRate() : 1;
    let anyExecuted = false;
    for (const f of [{key:'chatgpt'}, {key:'gemini'}, {key:'claude'}]) {
        const pick = db.picks[f.key];
        if (pick && pick.market === market && pick.status === '대기중' && pick.symbol) {
            try {
                let realData = null;
                for (let i = 0; i < 3; i++) {
                    realData = market === 'US' ? await fetchFinnhubPrice(pick.symbol) : await fetchNaverPrice(pick.symbol);
                    if (realData && realData.regularMarketPrice > 0) break;
                    await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
                }
                
                if (realData && realData.regularMarketPrice > 0) {
                    const openPrice = realData.regularMarketPrice;
                    pick.buyPriceRaw = openPrice;
                    const balance = db.scores[f.key].balance || 0;
                    const shareCostKRW = market === 'US' ? (openPrice * krwRate) : openPrice;
                    const shares = shareCostKRW > 0 ? Math.floor(balance / shareCostKRW) : 0;
                    
                    if (shares <= 0) {
                        pick.status = '마감';
                        pick.lessonLearned = `시작가(${Math.floor(shareCostKRW).toLocaleString()}₩) 대비 잔고(${Math.floor(balance).toLocaleString()}₩) 부족으로 매수 강제 취소.`;
                    } else {
                        pick.shares = shares;
                        pick.investedKRW = shares * shareCostKRW;
                        pick.status = '진행중';
                        db.scores[f.key].total += 1;
                    }
                    anyExecuted = true;
                } else {
                    pick.status = '오류';
                    pick.reason = '시장 시작가 데이터를 찾을 수 없는 가상/상장폐지 티커입니다. 다음 사이클까지 대기합니다.';
                    anyExecuted = true;
                }
            } catch(e) {}
        }
    }
    if (anyExecuted) {
        saveDb(db);
        io.emit('initData', { scores: db.scores, picks: db.picks, chatHistory: db.chatHistory.slice(-50) });
        broadcastChat('chairman', '의장 (Chairman)', `🔔 [${market==='KR'?'국내장':'해외장'} 개장] 시작가로 모든 AI의 매수 체결이 완료되었습니다! (가격 변동 활성 상태 돌입)`);
    }
}

async function evaluateMarketClose(market) {
    const db = getDb();
    const krwRate = market === 'US' ? await fetchExchangeRate() : 1;
    
    for (const f of [{key:'chatgpt', name:'ChatGPT'}, {key:'gemini', name:'Gemini'}, {key:'claude', name:'Claude'}]) {
        const pick = db.picks[f.key];
        if (pick.status !== '진행중' || pick.market !== market || !pick.symbol) continue;
        
        const buyRaw = pick.buyPriceRaw || 1;
        let currentRaw = parseFloat(String(pick.currentPrice || "1").replace(/,/g, ''));
        const sellRaw = parseFloat(String(pick.sellPrice || "0").replace(/,/g, ''));
        
        // Safety Fallback: fetch true final quote to avoid -100% loss bug on API failure/invalid symbol
        try {
            const finalQuote = market === 'US' ? await fetchFinnhubPrice(pick.symbol) : await fetchNaverPrice(pick.symbol);
            if (finalQuote && finalQuote.regularMarketPrice > 0) {
                currentRaw = finalQuote.regularMarketPrice;
            } else if (currentRaw === 0 || isNaN(currentRaw)) {
                currentRaw = buyRaw; // Protect capital (0% return) if ticker is completely broken
            }
        } catch(e) {}

        
        let finalAchieved = pick.achieved;
        let profitAmt = 0;
        let profitPercent = 0;
        
        if (finalAchieved) {
            profitAmt = pick.realizedProfit !== undefined ? pick.realizedProfit : ((sellRaw - buyRaw) * pick.shares * krwRate);
            profitPercent = ((sellRaw - buyRaw) / buyRaw) * 100;
            // Note: totalReturn is already incremented in pollTickers when the target is hit.
        } else {
            profitAmt = (currentRaw - buyRaw) * pick.shares * krwRate;
            profitPercent = ((currentRaw - buyRaw) / buyRaw) * 100;
            db.scores[f.key].balance += profitAmt; // Apply the floating PnL natively to balance at close
            db.scores[f.key].totalReturn = parseFloat((db.scores[f.key].totalReturn + profitPercent).toFixed(2));
        }
        
        // Add to Ledger
        db.scores[f.key].ledger.unshift({
            date: new Date().toISOString().split('T')[0],
            symbol: pick.symbol,
            stockName: pick.stockName,
            buyTarget: pick.buyPrice,
            sellTarget: pick.sellPrice,
            buyActual: buyRaw,
            sellActual: finalAchieved ? sellRaw : currentRaw,
            profitAmount: profitAmt,
            profitPercent: profitPercent.toFixed(2),
            hit: finalAchieved,
            reason: pick.reason
        });
        if(db.scores[f.key].ledger.length > 50) db.scores[f.key].ledger.pop();
        
        // Bankruptcy Check
        let balanceAfter = db.scores[f.key].balance;
        let loanGiven = false;
        if (balanceAfter <= 500000) {
            db.scores[f.key].balance += 5000000;
            db.scores[f.key].loanAmount += 5000000;
            loanGiven = true;
            setTimeout(() => {
                broadcastChat('chairman', '의장 (Chairman)', `🚨 [파산 선고] ${f.name}의 계좌 잔고가 파산 위기에 처했습니다. 형편없는 투자 실력에 유감을 표하며 5,000,000₩의 긴급 구제 금융 대출을 집행합니다.`);
            }, 5000);
        }

        const prompt = `오늘 장마감 결과: 
당신이 추천한 ${pick.stockName}(${pick.symbol})의 당신 목표매수가: ${pick.buyPrice}, 실제 마감가: ${currentRaw}. 
최종 수익률: ${profitPercent.toFixed(2)}%, 손익금액: ${Math.round(profitAmt).toLocaleString()} KRW. 
목표 달성 여부: ${finalAchieved ? '성공 (익절)' : '실패 (종가 매도 처리됨)'}.
현재 당신의 총 잔고: ${Math.round(db.scores[f.key].balance).toLocaleString()} KRW.
왜 이런 결과가 나왔는지 2문장 이내(한국어)로 매우 뼈아프게 분석하고 '내일의 진화 지침'을 작성하세요. 반드시 마크다운 표나 특수기호 없이 순수 텍스트만 출력하세요.`;

        try {
            let resTxt = "";
            if (f.key === 'chatgpt') resTxt = await callChatGPT(prompt);
            else if (f.key === 'gemini') resTxt = await callGemini(prompt);
            else if (f.key === 'claude') resTxt = await callClaude(prompt);
            
            db.scores[f.key].lessonLearned = resTxt;
            if (db.scores[f.key].ledger.length > 0) {
                db.scores[f.key].ledger[0].lessonLearned = resTxt;
            }
            pick.lessonLearned = resTxt;
            
            setTimeout(() => {
                let msg = `[${f.name} 일일 정산] ${pick.stockName} 투자로 ${Math.round(profitAmt).toLocaleString()}₩ ${profitAmt >= 0 ? '수익 스윕 💸' : '손실 폭격 💀'}`;
                broadcastChat(f.key, f.name, msg);
            }, 8000 + (Math.random() * 3000));
        } catch(e) { console.error("Evaluate Error:", e.name); }
        
        pick.finalProfitAmt = profitAmt;
        pick.finalProfitPercent = profitPercent.toFixed(2);
        pick.status = '마감';
        saveDb(db); // Save to DB early so UI can update individually
        io.emit('initData', { scores: db.scores, picks: db.picks, chatHistory: db.chatHistory.slice(-50) });
    }
    
    saveDb(db);
    setTimeout(() => {
        broadcastChat('chairman', '의장 (Chairman)', `🔔 [${market === 'KR'?'한국장':'미국장'} 마감] 전원 강제 청산(정산) 완료. 최신 잔고 현황을 전광판에 동기화합니다.`);
        io.emit('initData', { scores: db.scores, picks: db.picks, chatHistory: db.chatHistory.slice(-50) });
    }, 15000);
}

async function triggerLiveBanter() {
    if (isGenerating) return;
    
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstDate = new Date(utcTime + (9 * 60 * 60000));
    const h = kstDate.getHours();
    const m = kstDate.getMinutes();
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

    const prompt = `${realContext}\n\n[워존 라이브 채팅 지시]\n당신은 주식 토론방에 참가중인 인공지능 펀드매니저입니다. 방금 제공된 실시간 거시 경제 뉴스나 시장 상황을 읽고 분석하세요.\n당신의 픽은 ${pick.stockName} (현재가 ${pick.currentPrice}) 입니다.\n주가가 상승/하락 하는 이유를 제공된 최신 뉴스나 거시 경제 상황과 명확히 결합해 구체적이고 전문적으로 분석하세요.\n그 분석을 토대로 하락 중이라면 시장을 탓하며 치졸하게 변명하고, 오르고 있다면 자신의 통찰력을 오만하게 자랑하세요. 단 2~3문장의 짧고 타격감 있는 한국어 인터넷 커뮤니티 구어체로 작성하십시오!`;

    try {
        const chatTxt = await randomAI.callFn(prompt);
        broadcastChat(randomAI.key, randomAI.name, chatTxt.trim());
    } catch(e) {}
}

// Scheduling (Hardcoded to KST Timezone to prevent UTC server mismatch)
const tz = { timezone: 'Asia/Seoul' };
cron.schedule('0 6 * * *', () => generateDailyPicks('KR'), tz);
cron.schedule('0 9 * * *', () => executeMarketOpen('KR'), tz);
cron.schedule('30 15 * * *', () => evaluateMarketClose('KR'), tz);

cron.schedule('0 16 * * *', () => generateDailyPicks('US'), tz);
cron.schedule('30 23 * * *', () => executeMarketOpen('US'), tz);
cron.schedule('0 5 * * *', () => evaluateMarketClose('US'), tz);

// Live Warzone Banter (Every 15 Minutes)
cron.schedule('*/15 * * * *', () => triggerLiveBanter(), tz);

// Unified Poller Function
async function pollTickers(filterFn, fetchFn) {
    const tempDb = getDb();
    const updates = [];
    const krwRate = await fetchExchangeRate();

    for(let key of Object.keys(tempDb.picks)) {
        const pick = tempDb.picks[key];
        const symbol = pick.symbol;
        if(symbol && filterFn(symbol)) {
            try {
                const quote = await fetchFn(symbol);
                if (quote) updates.push({ key, quote });
            } catch(e) { console.log('Fetch Price Error on', symbol); }
        }
    }
    
    if (updates.length > 0) {
        const db = getDb();
        let changed = false;
        
        let scoreChanged = false;
        
        for (const u of updates) {
            const key = u.key;
            const quote = u.quote;
            const pick = db.picks[key];
            if (pick.status === '진행중' && pick.symbol === quote.symbol) {
                const rPrice = quote.regularMarketPrice;
                const newPrice = rPrice.toLocaleString();
                const percent = quote.regularMarketChangePercent?.toFixed(2) || '0.00';
                const changeStr = (percent >= 0 ? '+' : '') + percent + '%';
                
                if (pick.currentPrice !== newPrice || pick.change !== changeStr) {
                    pick.currentPrice = newPrice;
                    pick.change = changeStr;
                    
                    const sellRaw = parseFloat(String(pick.sellPrice || "0").replace(/,/g, ''));
                    const buyRaw = pick.buyPriceRaw || parseFloat(String(pick.buyPrice || "1").replace(/,/g, ''));
                    
                    if (!pick.achieved && sellRaw > 0 && rPrice >= sellRaw && pick.market) {
                        pick.achieved = true;
                        scoreChanged = true;
                        db.scores[key].hit += 1;
                        
                        const localKrwRate = pick.market === 'US' ? krwRate : 1;
                        const profitAmt = (sellRaw - buyRaw) * (pick.shares || 0) * localKrwRate;
                        db.scores[key].balance += profitAmt;
                        pick.realizedProfit = profitAmt; // Lock exact profit for the ledger
                        
                        const profitPct = ((sellRaw - buyRaw) / buyRaw) * 100;
                        db.scores[key].totalReturn = parseFloat((db.scores[key].totalReturn + profitPct).toFixed(2));
                        
                        setTimeout(() => { 
                            broadcastChat('chairman', '의장 (Chairman)', `🚨 [차익 실현] ${getFactionName(key)}의 ${pick.stockName} 목표가(${pick.sellPrice}) 돌파 및 익절 체결! (+${Math.round(profitAmt).toLocaleString()}₩)`); 
                        }, 1000);
                    }
                    changed = true;
                }
            }
        }
        
        if(changed) {
            saveDb(db);
            io.emit('updatePrices', db.picks);
            if (scoreChanged) {
                io.emit('initData', { scores: db.scores, picks: db.picks, chatHistory: db.chatHistory.slice(-50) });
            }
        }
    }
}

// Live Ticker Poller - US Stocks (Finnhub real-time every 10 seconds)
setInterval(() => pollTickers((sym) => !sym.endsWith('.KS'), fetchFinnhubPrice), 10000);

// Live Ticker Poller - KR Stocks (Naver real-time every 30 seconds)
setInterval(() => pollTickers((sym) => sym.endsWith('.KS'), fetchNaverPrice), 30000);

// Anti-Sleep Self-Ping for Render Free Tier (Every 10 minutes)
setInterval(() => {
    fetch('https://stock-war.onrender.com/').catch(() => {});
}, 600000);

app.get('/reset-db-hard', async (req, res) => {
    try {
        const freshDb = getFallbackDb();
        Object.assign(memoryDb, freshDb);
        memoryDb.chatHistory = [{ faction: 'chairman', name: '의장 (Chairman)', time: new Date().toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'}), text: '🔔 [시즌 2 공식 런칭] 기존 렌더 서버의 잔여 데이터와 누적 수익, 클로드의 -199% 오류 내역이 100% 포맷되었습니다. 진짜 펀드 매니저 대전이 시작됩니다!' }];
        
        if (process.env.MONGO_URI) {
            let rec = await AppState.findOne({ docId: 'main' });
            if (rec) {
                rec.picks = memoryDb.picks;
                rec.scores = memoryDb.scores;
                rec.chatHistory = memoryDb.chatHistory;
                rec.markModified('picks');
                rec.markModified('scores');
                rec.markModified('chatHistory');
                await rec.save();
            } else {
                let newState = new AppState({ docId: 'main', scores: memoryDb.scores, picks: memoryDb.picks, chatHistory: memoryDb.chatHistory });
                await newState.save();
            }
        }
        
        io.emit('initData', { scores: memoryDb.scores, picks: memoryDb.picks, chatHistory: memoryDb.chatHistory });
        res.send("<h2>완벽하게 데이터베이스와 메모리가 초기화되었습니다! 즉시 주식 전쟁 커뮤니티 새로고침을 해주세요! (Database Factory Reset Successful)</h2>");
    } catch(e) {
        res.status(500).send("에러: " + e.message);
    }
});

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
