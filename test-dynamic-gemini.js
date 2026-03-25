import fetch from 'node-fetch';
import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = "AIzaSyCT9jfENxUrJUMKRQbKKIINJl2mbBrC5Z8";
const genAI = new GoogleGenerativeAI(apiKey);

async function testDynamic() {
    console.log("Fetching available models to bypass 404...");
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();
    
    if (data.models) {
        const validModels = data.models.filter(m => 
            m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent') &&
            m.name.includes('gemini')
        );
        
        console.log("Allowed Gemini Text Models:", validModels.map(m => m.name));
        
        let target = validModels.find(m => m.name === 'models/gemini-1.5-pro');
        if (!target) target = validModels.find(m => m.name.includes('gemini-1.5-flash') && !m.name.includes('8b'));
        if (!target) target = validModels[0];
        
        const modelName = target.name.replace('models/', '');
        console.log("DYNAMICALLY CHOSEN MODEL:", modelName);
        
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Respond with the word SUCCESS");
            console.log("GENERATION OUTPUT:", result.response.text());
        } catch (e) {
            console.error("GENERATION FAILED:", e.message);
        }
    } else {
        console.log("No models returned or invalid key.", data);
    }
}

testDynamic();
