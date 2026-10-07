import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
console.log('Testing Gemini 2.0 Flash with key ending in:', apiKey ? apiKey.slice(-4) : 'MISSING');

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function run() {
    try {
        const prompt = 'Hello! Are you working properly? Reply with "YES, I AM ALIVE".';
        const result = await model.generateContent(prompt);
        const response = await result.response;
        console.log('Response:', response.text());
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Details:', JSON.stringify(error.response, null, 2));
        }
    }
}

run();
