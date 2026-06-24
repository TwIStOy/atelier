export class GoalAlreadyExistsError extends Error {
  constructor(goalId: string) {
    super(`Goal already exists: ${goalId}`);
    this.name = "GoalAlreadyExistsError";
  }
}

export class GoalNotFoundError extends Error {
  constructor(threadId: string) {
    super(`No goal found for thread: ${threadId}`);
    this.name = "GoalNotFoundError";
  }
}

export class InvalidGoalStoreError extends Error {
  constructor(reason: string) {
    super(`Invalid goal store: ${reason}`);
    this.name = "InvalidGoalStoreError";
  }
}

export class UnsupportedGoalStoreVersionError extends Error {
  constructor(version: number) {
    super(`Unsupported goal store version: ${version}`);
    this.name = "UnsupportedGoalStoreVersionError";
  }
}
