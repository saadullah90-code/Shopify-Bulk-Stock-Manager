import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import shopifyRouter from "./shopify";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(shopifyRouter);

export default router;
