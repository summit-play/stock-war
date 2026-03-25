import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI("AIzaSyCT9jfENxUrJUMKRQbKKIINJl2mbBrC5Z8");

async function runTest(modelName) {
    try {
        console.log(`Testing model: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        const res = await model.generateContent("Say hello in 5 words.");
        console.log(`SUCCESS [${modelName}]:`, res.response.text());
    } catch(e) { 
        console.error(`FAILED [${modelName}]:`, e.message); 
    }
}

async function start() {
    await runTest("gemini-1.5-flash");
    await runTest("gemini-1.5-pro-latest");
    await runTest("gemini-1.0-pro");
    await runTest("gemini-pro");
}

start();
