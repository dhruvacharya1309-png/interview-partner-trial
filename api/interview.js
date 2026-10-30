// api/interview.js - Conversational AI Engine with Groq Whisper & Socratic Evaluation
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
    // 1. GROQ WHISPER HIGH-SPEED TRANSCRIPTION ACTION
    if (action === 'transcribe') {
      const GROQ_KEY = cleanKey(process.env.GROQ_API_KEY);
      if (!GROQ_KEY) {
        return res.status(500).json({ error: 'GROQ_API_KEY is not configured in Vercel environment variables.' });
      }

      if (!audioBase64) {
        return res.status(400).json({ error: 'No audio data payload provided.' });
      }

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

    if (!GEMINI_KEY) {
      return res.status(500).json({ 
        error: 'GEMINI_API_KEY is missing in Vercel Environment Variables.' 
      });
    }

    // 2. HUMAN CONVERSATIONAL SOCRATIC FOLLOW-UP ACTION
    if (action === 'followup') {
      const systemPrompt = `You are a human, senior executive interviewer conducting a professional placement interview.

Context:
Question Asked: "${questionText}"
Model Answer Guidelines: "${idealAnswer}"
Candidate's Spoken Response: "${transcript}"

Your Persona Rules:
1. Speak like a natural human interviewer (use phrasing like "Got it,", "That makes sense,", "I hear your point on...", "Fair enough,").
2. Acknowledge ONE specific detail from what the candidate said.
3. If their answer lacks operational depth, metrics, or trade-off reasoning, ask ONE sharp, conversational follow-up question (1-2 sentences).
4. If their answer is thorough and well-explained, respond with a short conversational bridge acknowledging their point and reply with "NO_FOLLOWUP".`;

      const aiReply = await callGemini(systemPrompt, transcript, GEMINI_KEY);
      
      if (!aiReply || aiReply.includes("NO_FOLLOWUP")) {
        return res.status(200).json({ trigger: false, prompt: "" });
      }
      return res.status(200).json({ trigger: true, prompt: aiReply.replace(/["']/g, "").trim() });
    }

    // 3. READINESS TIER & DIAGNOSTIC DOSSIER EVALUATION
    if (action === 'report') {
      const systemPrompt = `You are an Executive Hiring Committee Chair evaluating a placement candidate.

EVALUATION RUBRIC:
Categorize the candidate into EXACTLY one of these 3 Readiness Tiers based on their verbatim spoken responses:

- "Tier 1: Placement Ready"
  • Demonstrates structured, multi-dimensional business logic (explains what, how, and why).
  • Uses precise domain terminology naturally without fluff.
  • Defends reasoning clearly when challenged.

- "Tier 2: Developing"
  • Correct basic theoretical knowledge, but responses stay high-level or generic.
  • Needs prompting to uncover operational metrics.

- "Tier 3: Needs Practice"
  • Conceptual misunderstandings, extreme brevity, or surface-level buzzwords without substance.

Return ONLY a valid, raw JSON object (no markdown code wrappers) with this exact schema:
{
  "readinessTier": "Tier 1: Placement Ready | Tier 2: Developing | Tier 3: Needs Practice",
  "tierColor": "green | blue | red",
  "overallSummary": "A 2-3 sentence executive evaluation summarizing overall performance.",
  "evaluations": [
    {
      "questionIndex": 1,
      "strengths": "Specific business arguments or frameworks articulated well.",
      "gaps": "Missing operational logic, unbacked assertions, or missing metrics.",
      "executiveRewrite": "An elevated 2-sentence C-suite reframing of their response."
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
  const targetUrl = `[suspicious link removed]{apiKey}`;

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  
  if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text.trim();
  }
  return "";
}
