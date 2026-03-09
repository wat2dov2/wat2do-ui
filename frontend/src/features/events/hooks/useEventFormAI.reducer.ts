export interface AIState {
  aiPrompt: string;
  aiGenerating: boolean;
}

export type AIAction =
  | { type: "SET_AI_PROMPT"; payload: string }
  | { type: "SET_AI_GENERATING"; payload: boolean }
  | { type: "RESET" };

export const initialAIState: AIState = {
  aiPrompt: "",
  aiGenerating: false,
};

export function aiReducer(state: AIState, action: AIAction): AIState {
  switch (action.type) {
    case "SET_AI_PROMPT":
      return { ...state, aiPrompt: action.payload };
    case "SET_AI_GENERATING":
      return { ...state, aiGenerating: action.payload };
    case "RESET":
      return initialAIState;
    default:
      return state;
  }
}
