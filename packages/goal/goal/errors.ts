export class GoalAlreadyExistsError extends Error {
  constructor(message = "Goal already exists") {
    super(message);
    this.name = "GoalAlreadyExistsError";
  }
}

export class GoalNotFoundError extends Error {
  constructor(message = "Goal not found") {
    super(message);
    this.name = "GoalNotFoundError";
  }
}

export class InvalidGoalStoreError extends Error {
  constructor(message = "Invalid goal store payload") {
    super(message);
    this.name = "InvalidGoalStoreError";
  }
}

export class UnsupportedGoalStoreVersionError extends Error {
  constructor(version: unknown) {
    super(`Unsupported goal store version: ${String(version)}`);
    this.name = "UnsupportedGoalStoreVersionError";
  }
}
