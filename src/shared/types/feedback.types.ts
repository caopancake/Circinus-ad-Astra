import type { VNodeChild } from 'vue';
import type { FeedbackNotice } from '@/shared/types/error.types';

export interface ConfirmOptions {
  title: string;
  content?: string | (() => VNodeChild);
  actionText: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface ChoiceOption {
  label: string;
  value: string;
  type?: 'primary' | 'warning' | 'error' | 'default';
}

export interface ChooseOptions {
  title: string;
  content?: string | (() => VNodeChild);
  choices: ChoiceOption[];
}

export interface AppFeedback {
  success(message: string): void;
  info(message: string): void;
  warning(notice: FeedbackNotice): void;
  error(error: unknown, contextMessage?: string): void;
  confirmDanger(options: ConfirmOptions): void;
  confirmWarning(options: ConfirmOptions): void;
  choose(options: ChooseOptions): Promise<string | null>;
}
