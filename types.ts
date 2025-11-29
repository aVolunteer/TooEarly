export interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}

export enum SoundType {
  CLICK = 'CLICK',
  ADD = 'ADD',
  DELETE = 'DELETE',
  ALARM = 'ALARM',
}

export interface AppSettings {
  soundEnabled: boolean;
  timerEnabled: boolean;
  timerIntervalMinutes: number;
}