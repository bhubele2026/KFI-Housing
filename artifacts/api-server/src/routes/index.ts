import { Router, type IRouter } from "express";
import healthRouter from "./health";
import configRouter from "./config";
import resetRouter from "./reset";
import importRouter from "./import";
import customersRouter from "./customers";
import propertiesRouter from "./properties";
import leasesRouter from "./leases";
import leasesImportPdfRouter from "./leases-import-pdf";
import roomsRouter from "./rooms";
import bedsRouter from "./beds";
import occupantsRouter from "./occupants";
import utilitiesRouter from "./utilities";

const router: IRouter = Router();

router.use(healthRouter);
router.use(configRouter);
router.use(resetRouter);
router.use(importRouter);
router.use(customersRouter);
router.use(propertiesRouter);
router.use(leasesRouter);
router.use(leasesImportPdfRouter);
router.use(roomsRouter);
router.use(bedsRouter);
router.use(occupantsRouter);
router.use(utilitiesRouter);

export default router;
