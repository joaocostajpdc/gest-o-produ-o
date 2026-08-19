import { NextFunction, Request, Response } from "express";

// Envolve handlers assíncronos para encaminhar exceções para o middleware de erro do Express.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
