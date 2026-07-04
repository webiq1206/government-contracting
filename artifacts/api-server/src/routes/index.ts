import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import opportunitiesRouter from "./opportunities";
import subsRouter from "./subs";
import analyticsRouter from "./analytics";
import agentsRouter from "./agents";
import profileRouter from "./profile";
import complianceRouter from "./compliance";
import contractsRouter from "./contracts";
import callCardsRouter from "./call-cards";
import scoringWeightsRouter from "./scoring-weights";
import integrationsRouter from "./integrations";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/opportunities", opportunitiesRouter);
router.use("/subs", subsRouter);
router.use("/analytics", analyticsRouter);
router.use("/agents", agentsRouter);
router.use("/profile", profileRouter);
router.use("/compliance", complianceRouter);
router.use("/contracts", contractsRouter);
router.use("/call-cards", callCardsRouter);
router.use("/scoring-weights", scoringWeightsRouter);
router.use("/integrations", integrationsRouter);

export default router;
