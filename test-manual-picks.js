import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const KR_ARRAY = ['005930.KS', '000660.KS', '035420.KS', '035720.KS', '005380.KS', '068270.KS', '035900.KS', '000270.KS'];
const SYMBOLS = `005930.KS (삼성전자), 000660.KS (SK하이닉스), 035420.KS (NAVER), 035720.KS (카카오), 005380.KS (현대차), 068270.KS (셀트리온), 035900.KS (JYP Ent.), 000270.KS (기아)`;

async function run() {
    const prompt = `[Market Data Fake Context]\nYou are an elite, highly arrogant stock day-trader. Based EXACTLY on the real-time financial data provided above, you must pick ONE stock that will rise the most today from this allowed list: ${SYMBOLS}. Provide your suggested buy target price (near current) and sell target price. Provide a highly analytical, boasting reason (3 sentences max in Korean) packed with actual numbers (like PER, PBR, current price) explaining why it will explode today. Return ONLY strict JSON in this format, NO Markdown formatting, just raw JSON: {"symbol": "AAPL", "stockName": "Apple", "buyPrice": "150,000", "sellPrice": "155,000", "reason": "Detailed reason here."}`;

    console.log("Starting ChatGPT...");
    try {
        const r1 = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] });
        console.log("ChatGPT Output:", r1.choices[0].message.content);
    } catch(e) { console.error("ChatGPT Error:", e.message); }

    console.log("Starting Gemini Model Fetch...");
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await res.json();
        const validModels = data.models.filter(m => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'));
        const modelStr = validModels.find(m => m.name.includes('2.5-flash'))?.name.replace('models/', '') || 'gemini-1.5-flash';
        
        const model = genAI.getGenerativeModel({ model: modelStr });
        const r2 = await model.generateContent(prompt);
        console.log("Gemini Output:", r2.response.text());
    } catch(e) { console.error("Gemini Error:", e.message); }

    console.log("Starting Claude...");
    try {
        const msg = await anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            max_tokens: 500,
            messages: [{ role: "user", content: prompt }]
        });
        console.log("Claude Output:", msg.content[0].text);
    } catch(e) { console.error("Claude Error:", e.message); }
    
    console.log("Done isolated test.");
}
run();
