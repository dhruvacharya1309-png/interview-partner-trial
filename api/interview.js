// api/interview.js - Unified AI Engine with Groq Whisper & Socratic Evaluation
export default async function handler(req, res) {
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

  const { action, transcript, questionText, idealAnswer, sessionResults, audioBase64, mimeType } = req.body || {};

  const cleanKey = (val) => {
    if (!val) return '';
    return String(val).trim().replace(/^["']|["']$/g, '').replace(/[\r\n\t\s]/g, '');
  };

  const GEMINI_KEY = cleanKey(process.env.GEMINI_API_KEY || process.env.GEMINI_KEY);

  try {
    // 1. GROQ WHISPER HIGH-SPEED TRANSCRIPTION ACTION (Sub-500ms, 99%+ Accuracy)
    if (action === 'transcribe') {
      const GROQ_KEY = cleanKey(process.env.GROQ_API_KEY);
      if (!GROQ_KEY) {
        return res.status(500).json({ error: 'GROQ_API_KEY is not configured in Vercel environment variables.' });
      }

      if (!audioBase64) {
        return res.status(400).json({ error: 'No audio data payload provided.' });
      }

      // Convert base64 string back into audio binary blob
      const rawBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
      const audioBuffer = Buffer.from(rawBase64, 'base64');
      const blob = new Blob([audioBuffer], { type: mimeType || 'audio/webm' });

      const formData = new FormData();
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('response_format', 'json');

      const groqRes = await fetch('[suspicious link removed]', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: formData
      });

      const groqData = await groqRes.json();
      if (!groqRes.ok) {
        throw new Error(groqData.error?.message || `Groq Whisper API Error (${groqRes.status})`);
      }

      return res.status(200).json({ transcript: groqData.text || '' });
    }

    // Verify Gemini Key for Socratic evaluation actions
    if (!GEMINI_KEY) {
      return res.status(500).json({ 
        error: 'GEMINI_API_KEY is missing in Vercel Environment Variables.' 
      });
    }

    // 2. SOCRATIC REAL-TIME FOLLOW-UP ACTION
    if (action === 'followup') {
      const systemPrompt = `You are a senior executive interviewer conducting a high-stakes campus placement interview.
Question asked: "${questionText}"
Model answer guidelines: "${idealAnswer}"

Your Task:
Analyze the candidate's verbatim spoken response: "${transcript}"

1. If their answer is vague, incomplete, misses key operational logic, or makes an unbacked claim, ask ONE sharp, highly specific follow-up question (1-2 sentences) directly challenging what they said.
2. If their answer is thorough, structured, and well-reasoned, reply STRICTLY with the exact string "NO_FOLLOWUP".`;

      const aiReply = await callGemini(systemPrompt, transcript, GEMINI_KEY);
      
      if (!aiReply || aiReply.includes("NO_FOLLOWUP")) {
        return res.status(200).json({ trigger: false, prompt: "" });
      }
      return res.status(200).json({ trigger: true, prompt: aiReply.replace(/["']/g, "").trim() });
    }

    // 3. DIAGNOSTIC REPORT EVALUATION ACTION (TIER 1 / 2 / 3 RUBRIC)
    if (action === 'report') {
      const systemPrompt = `You are an Executive Hiring Committee Chair evaluating a placement candidate.

EVALUATION RUBRIC:
Categorize the candidate into EXACTLY one of these 3 Readiness Tiers based on their verbatim spoken responses:

- "Tier 1: Placement Ready"
  • Demonstrates structured, multi-dimensional business logic (explains what, how, and why).
  • Uses precise domain terminology and frameworks naturally without fluff.
  • Successfully defends or expands their reasoning when faced with follow-up challenges.

- "Tier 2: Developing"
  • Has correct basic theoretical knowledge, but responses stay generic or high-level.
  • Relies on informal diction or occasional filler phrases.
  • Needs follow-up questions to uncover complete operational details.

- "Tier 3: Needs Practice"
  • Demonstrates conceptual misunderstandings, relies entirely on surface buzzwords, or skips questions.
  • Spoken answers are extremely brief (under 10 seconds) or lack logical structure.
  • Fails or struggles to address Socratic follow-up challenges.

YOUR TASK:
Analyze the provided transcript array. Return ONLY a valid, raw JSON object (no markdown code wrappers) matching this exact schema:
{
  "readinessTier": "Tier 1: Placement Ready | Tier 2: Developing | Tier 3: Needs Practice",
  "tierColor": "green | blue | red",
  "overallSummary": "A 2-3 sentence executive evaluation explaining why they received this tier, highlighting analytical depth, trade-off reasoning, and communication clarity.",
  "evaluations": [
    {
      "questionIndex": 1,
      "strengths": "Specific business arguments or frameworks articulated well.",
      "gaps": "Missing operational logic, unbacked assertions, or missing metrics.",
      "executiveRewrite": "An elevated 2-sentence C-suite reframing of their exact response."
    }
  ]
}`;

      const jsonText = await callGemini(systemPrompt, JSON.stringify(sessionResults), GEMINI_KEY);
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

async function callGemini(systemPrompt, userPrompt, apiKey) {
  const targetUrl = '[suspicious link removed]';

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
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
  
  if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
    return data.candidates[0].content.parts[0].text.trim();
  }
  return "";
}
