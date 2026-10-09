export interface ErrorLocation {
  path: string | null;
  line: number | null;
  column: number | null;
}

export interface ErrorDiagnostic {
  code: string;
  message: string;
  location: ErrorLocation | null;
}

export interface FeedbackNotice {
  userMessage: string;
  diagnostic: ErrorDiagnostic;
}
