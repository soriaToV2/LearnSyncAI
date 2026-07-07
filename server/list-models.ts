import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}

const genai = new GoogleGenAI({ apiKey });

async function listAvailableModels() {
  try {
    console.log("Fetching available models...");
    const response = await genai.models.list({ config: { pageSize: 50 } });
    const models = [];
    for await (const model of response) {
      if (model.name.includes("gemini")) {
        models.push(model.name);
      }
    }
    console.log("Available Gemini models:");
    console.log(models.join('\n'));
  } catch (error: any) {
    console.error("Error listing models:", error.message);
  }
}

listAvailableModels();
