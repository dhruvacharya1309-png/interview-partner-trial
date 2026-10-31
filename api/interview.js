// api/interview.js - Executive AI Engine with Groq Whisper & Socratic Feedback
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

  const { action, transcript, questionText, idealAnswer, sessionResults, audioBase64, mimeType, consecutiveIdkCount } = req.body || {};

  const cleanKey = (val) => {
    if (!val) return '';
    return String(val).trim().replace(/^["']|["']$/g, '').replace(/[\r\n\t\s]/g, '');
  };

  const GEMINI_KEY = cleanKey(process.env.GEMINI_API_KEY || process.env.GEMINI_KEY);

  try {
    // 1. GROQ WHISPER SUB-500MS AUDIO TRANSCRIPTION
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
      formData.append('file', blob, 'recording.webm');
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
        throw new Error(groqData.error?.message || `Groq Whisper Error (${groqRes.status})`);
      }

      return res.status(200).json({ transcript: groqData.text || '' });
    }

    if (!GEMINI_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is missing in Vercel Environment Variables.' });
    }

    // 2. CONVERSATIONAL SOCRATIC FOLLOW-UP ENGINE
    if (action === 'followup') {
      const isIdk = transcript.toLowerCase().includes("don't know") || 
                    transcript.toLowerCase().includes("idk") || 
                    transcript.toLowerCase().includes("not sure") ||
                    transcript.toLowerCase().includes("pass");

      let systemPrompt = "";

      if (isIdk && consecutiveIdkCount >= 2) {
        systemPrompt = `You are an empathetic executive interviewer.
The candidate passed or said "I don't know" on two consecutive questions.
Acknowledge warmly in 1-2 sentences: "No worries at all—hitting a tough question is completely natural. Let me ask you a core concept to help us recalibrate."
Do NOT sound robotic or punitive.`;
      } else if (isIdk) {
        systemPrompt = `You are a human executive interviewer.
The candidate passed on this question.
Acknowledge smoothly in 1 sentence: "Fair enough, working through tough operational trade-offs is part of the process. Let's move to the next topic."`;
      } else {
        systemPrompt = `You are a senior executive interviewer conducting a high-stakes placement interview.
Question Asked: "${questionText}"
Model Answer Benchmark: "${idealAnswer}"
Candidate's Spoken Answer: "${transcript}"

Rules:
1. Speak naturally like a real human executive ("That makes sense,", "I hear your point on...", "Fair enough,").
2. Acknowledge ONE specific point from what the candidate said.
3. If their answer lacks operational depth or quantitative metrics, ask ONE sharp follow-up challenge (1-2 sentences).
4. If their answer is thorough and solid, reply strictly with "NO_FOLLOWUP".`;
      }

      const aiReply = await callGemini(systemPrompt, transcript, GEMINI_KEY);
      
      if (!aiReply || aiReply.includes("NO_FOLLOWUP")) {
        return res.status(200).json({ trigger: false, prompt: "" });
      }
      return res.status(200).json({ trigger: true, prompt: aiReply.replace(/["']/g, "").trim() });
    }

    // 3. READINESS TIER ASSESSMENT DOSSIER
    if (action === 'report') {
      const systemPrompt = `You are an Executive Hiring Committee Chair evaluating a placement candidate.

EVALUATION RUBRIC:
Categorize the candidate into EXACTLY one of these 3 Readiness Tiers:
- "Tier 1: Placement Ready" (Structured logic, domain jargon, defends reasoning)
- "Tier 2: Developing" (Correct basic knowledge, but stays generic/high-level)
- "Tier 3: Needs Practice" (Conceptual gaps, extreme brevity, surface buzzwords, or multiple skipped questions)

Return ONLY a raw JSON object (no markdown code blocks):
{
  "readinessTier": "Tier 1: Placement Ready | Tier 2: Developing | Tier 3: Needs Practice",
  "tierColor": "green | blue | red",
  "overallSummary": "A comprehensive 3-4 sentence evaluation of analytical depth, trade-off reasoning, and poise.",
  "idkAnalysis": "A short summary evaluating transparency vs domain gaps.",
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
