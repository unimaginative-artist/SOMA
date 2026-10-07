import { GoogleGenAI, Type } from "@google/genai";
import { SYSTEM_PROMPT_CORE } from '../constants';
import { WorkflowPlan, TaskStatus } from '../types';

let genAI: GoogleGenAI | null = null;

const getGenAI = () => {
  if (!genAI) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    if (!apiKey) {
      console.warn("API Key not found in environment.");
      return null;
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
};

export const orchestratePlan = async (userGoal: string): Promise<WorkflowPlan | null> => {
  const ai = getGenAI();
  if (!ai) return null;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Fast model for orchestration
      contents: userGoal,
      config: {
        systemInstruction: SYSTEM_PROMPT_CORE,
        responseMimeType: "application/json",
        // Using a schema for strict JSON output
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            goal: { type: Type.STRING },
            summary: { type: Type.STRING },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  description: { type: Type.STRING },
                  assignedArbiterRole: { type: Type.STRING },
                  dependencies: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["id", "description", "assignedArbiterRole", "dependencies"]
              }
            }
          },
          required: ["goal", "steps", "summary"]
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) return null;

    const parsed = JSON.parse(jsonText);

    // Enrich with initial status and empty logs
    const plan: WorkflowPlan = {
      goal: parsed.goal,
      summary: parsed.summary,
      steps: parsed.steps.map((s: any) => ({
        ...s,
        status: TaskStatus.PENDING,
        logs: [],
        output: undefined,
        rationale: "Waiting for execution..."
      })),
      createdAt: Date.now()
    };

    return plan;

  } catch (error) {
    console.error("Orchestration failed:", error);
    return null;
  }
};