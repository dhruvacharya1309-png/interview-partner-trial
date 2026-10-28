// api/interview.js - Working Vercel Serverless Function
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, Date'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, transcript, questionText, idealAnswer, sessionResults } = req.body || {};

  // Clean helper to remove quotes, brackets, and whitespace
  const sanitizeKey = (val) => {
    if (!val) return '';
    return String(val).trim().replace(/^["']|["']$/g, '').replace(/[\r\n\t\s]/g, '');
  };

  const GEMINI_KEY = sanitizeKey(process.env.GEMINI_API_KEY || process.env.GEMINI_KEY);
  const OPENAI_KEY = sanitizeKey(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY);
  const GROQ_KEY = sanitizeKey(process.env.GROQ_API_KEY || process.env.GROQ_KEY);

  if (!GEMINI_KEY && !OPENAI_KEY && !GROQ_KEY) {
    return res.status(500).json({ 
      error: 'No API key found in Vercel Environment Variables. Please set GEMINI_API_KEY in Vercel Settings.' 
    });
  }

  try {
    // 1. REAL-TIME SOCRATIC FOLLOW-UP ACTION
    if (action === 'followup') {
      const systemPrompt = `You are a senior executive interviewer conducting a campus placement interview.
Question asked: "${questionText}"
Model answer guidelines: "${idealAnswer}"

Your Task:
Analyze the candidate's verbatim spoken response: "${transcript}"

1. If their answer is vague, incomplete, misses key operational logic, or makes an unbacked claim, ask ONE sharp, highly specific follow-up question (1-2 sentences) directly challenging or probing what they just said. Sound like a real interviewer in the room.
2. If their answer is clear, thorough, and well-reasoned, reply STRICTLY with the exact string "NO_FOLLOWUP".`;

      const aiReply = await callLLM(systemPrompt, transcript, { OPENAI_KEY, GEMINI_KEY, GROQ_KEY });
      
      if (!aiReply || aiReply.includes("NO_FOLLOWUP")) {
        return res.status(200).json({ trigger: false, prompt: "" });
      }
      return res.status(200).json({ trigger: true, prompt: aiReply.replace(/["']/g, "").trim() });
    }

    // 2. DIAGNOSTIC REPORT EVALUATION ACTION
    if (action === 'report') {
      const systemPrompt = `You are an Executive Hiring Committee Chair. Analyze this candidate's placement interview transcripts.
Return ONLY a valid, raw JSON object (no markdown wrappers) with this exact schema:
{
  "readinessTier": "Tier 1 (Placement Ready)",
  "overallSummary": "A concise 2-3 sentence executive evaluation of their overall performance, depth, and communication.",
  "evaluations": [
    {
      "questionIndex": 1,
      "strengths": "Key business arguments they articulated well.",
      "gaps": "Specific missing business logic or operational flaws.",
      "executiveRewrite": "An elevated, C-suite level 2-sentence re-frame of their specific answer."
    }
  ]
}`;

      const jsonText = await callLLM(systemPrompt, JSON.stringify(sessionResults), { OPENAI_KEY, GEMINI_KEY, GROQ_KEY });
      const cleanJson = jsonText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleanJson);

      return res.status(200).json(parsed);
    }

    return res.status(400).json({ error: 'Invalid action requested' });
  } catch (err) {
    console.error("Vercel AI Endpoint Error:", err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}

async function callLLM(systemPrompt, userPrompt, { OPENAI_KEY, GEMINI_KEY, GROQ_KEY }) {
  // Option A: Google Gemini API
  if (GEMINI_KEY) {
    const host = "generativelanguage" + "." + "googleapis" + "." + "com";
    const path = "/v1beta/models/gemini-1.5-flash:generateContent";
    const url = "https://" + host + path;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_KEY
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nCandidate Input:\n${userPrompt}` }]
        }]
      })
    });
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error?.message || `Gemini API Error (${res.status})`);
    }
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  }

  // Option B: Groq API
  if (GROQ_KEY) {
    const host = "api" + "." + "groq" + "." + "com";
    const url = "https://" + host + "/openai/v1/chat/completions";
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Groq API Error (${res.status})`);
    return data?.choices?.[0]?.message?.content?.trim() || "";
  }

  // Option C: OpenAI API
  if (OPENAI_KEY) {
    const host = "api" + "." + "openai" + "." + "com";
    const url = "https://" + host + "/v1/chat/completions";
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `OpenAI API Error (${res.status})`);
    return data?.choices?.[0]?.message?.content?.trim() || "";
  }

  throw new Error('No valid API key configured.');
}
