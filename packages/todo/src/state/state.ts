import type { Task } from "../tool/types.ts";

export interface TaskState {
  tasks: Task[];
  nextId: number;
}

export const EMPTY_STATE: TaskState = { tasks: [], nextId: 1 };
