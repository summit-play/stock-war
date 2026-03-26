import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function extractJson(text) {
    try {
        let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const match = cleanText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : null;
    } catch(e) { return null; }
}

async function getGeminiModelString() {
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await res.json();
        const validModels = data.models.filter(m => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'));
        const target = validModels.find(m => m.name.includes('gemini-2.5-flash')) || validModels.find(m => m.name.includes('gemini-2.0-flash')) || validModels.find(m => m.name.includes('gemini-1.5-flash')) || validModels[0];
        return target.name.replace('models/', '');
    } catch(e) { return 'gemini-1.5-flash-latest'; }
}

async function run() {
    const prompt = `📊 [현재 실시간 상장 주가 및 기초 데이터]
- [005930] 현재가: 183900, 일일변동률: -2.70%, PBR: N/A, PER: N/A, 52주최고: N/A
- [000660] 현재가: 153000, 일일변동률: 1.20%, PBR: N/A, PER: N/A, 52주최고: N/A

You are a highly professional Wall Street analyst. Based EXACTLY on the real-time financial data and news headlines provided above, you must pick ONE stock that will rise the most today from this allowed list: 005930 (삼성전자), 000660 (SK하이닉스). Provide your suggested buy target price (near current) and sell target price. Provide a highly analytical reason (3 sentences max in Korean) packed with actual numbers. Return ONLY strict JSON in this format, NO Markdown formatting, just raw JSON: {"symbol": "AAPL", "stockName": "Apple", "buyPrice": "150.50", "sellPrice": "155.00", "reason": "Detailed reason here.", "newsLink": "https://news.url.here"}

[CRITICAL RULE]: For buyPrice and sellPrice, you MUST return purely numerical digits (e.g. 185000 for KRW, 150.50 for USD). NEVER USE COMMAS (,). NEVER USE SYMBOLS ($/₩). If you hallucinate the currency or use commas, your system will be terminated.`;

    try {
        const str = await getGeminiModelString();
        console.log("Resolved Model:", str);
        const model = genAI.getGenerativeModel({ model: str });
        const res = await model.generateContent(prompt);
        const text = res.response.text();
        console.log("=== RAW GEMINI TEXT ===");
        console.log(text);
        console.log("=== PARSED JSON ===");
        console.log(extractJson(text));
    } catch(e) {
        console.error("Gemini Error:", e);
    }
    process.exit(0);
}
run();
