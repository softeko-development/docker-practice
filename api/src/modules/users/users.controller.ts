import type { RequestHandler } from "express";
import { usersService } from "./users.service.js";
import type { CreateUserInput, ListUsersQuery } from "./users.schema.js";

export const listUsers: RequestHandler = async (_req, res) => {
  const result = await usersService.list(res.locals.query as ListUsersQuery);
  res.json(result);
};

export const createUser: RequestHandler = async (_req, res) => {
  const user = await usersService.create(res.locals.body as CreateUserInput);
  res.status(201).json({ data: user });
};
