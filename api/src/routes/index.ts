import { Router } from "express";
import { usersRouter } from "../modules/users/users.routes.js";

export const apiRouter = Router();

// Register each module's router here.
apiRouter.use("/users", usersRouter);
