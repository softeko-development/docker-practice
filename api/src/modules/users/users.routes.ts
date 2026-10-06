import { Router } from "express";
import { validate } from "../../common/validate.js";
import { createUser, listUsers } from "./users.controller.js";
import { createUserSchema, listUsersQuerySchema } from "./users.schema.js";

export const usersRouter = Router();

usersRouter.get("/", validate(listUsersQuerySchema, "query"), listUsers);
usersRouter.post("/", validate(createUserSchema, "body"), createUser);
