export class AppError extends Error {
  status: number;
  code: string;

  
  constructor(status: number, message: string, code = "ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
