import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { generateJsonFromDocument } from './lib/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function testExtraction() {
  console.log("Reading PPTX file...");
  const filePath = path.resolve(__dirname, '../7. Information Security.pptx');
  
  if (!fs.existsSync(filePath)) {
    console.error("File not found at", filePath);
    return;
  }

  const fileBuffer = fs.readFileSync(filePath);
  const base64File = fileBuffer.toString('base64');
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  const prompt = `
You are an expert academic concept extractor.
Analyze the attached document and extract the most important terms and their definitions.

Return a JSON array of objects with this exact shape:
[{ "term": "string", "definition": "string" }]

Rules:
- Extract all key concepts without missing important details
- Definitions should be concise (1–3 sentences)
- Focus on domain-specific terminology
`;

  try {
    console.log("Sending to Gemini API...");
    const concepts = await generateJsonFromDocument(prompt, mimeType, base64File);
    console.log(`Success! Extracted ${concepts.length} concepts.`);
  } catch (error: any) {
    console.error("Gemini API Error:");
    console.error(error?.message || error);
  }
}

testExtraction();
