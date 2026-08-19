import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { ThinkingLevel } from '@google/genai';
import { generateJsonFromDocument, GEMINI_EXTRACTION_MODEL } from './lib/gemini.js';

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
    // `model` is required as of 2026-08-19 — this used to inherit a
    // `gemini-2.5-flash` default that has returned HTTP 404 for months.
    // `thinkingLevel` and `maxOutputTokens` are explicit because the extraction
    // model is a `gemini-3*` one, where thinking is on by default and its tokens
    // draw on the same output budget: left unset, a long deck truncates
    // mid-array and surfaces as unparseable JSON rather than as a limit.
    const concepts = await generateJsonFromDocument<{ term: string; definition: string }[]>(
      prompt,
      mimeType,
      base64File,
      {
        model: GEMINI_EXTRACTION_MODEL,
        thinkingLevel: ThinkingLevel.LOW,
        maxOutputTokens: 8192,
      }
    );
    console.log(`Success! Extracted ${concepts.length} concepts.`);
  } catch (error: any) {
    console.error("Gemini API Error:");
    console.error(error?.message || error);
  }
}

testExtraction();
