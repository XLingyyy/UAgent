#!/usr/bin/env node
/* global process */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { liveProducerMain, runLiveProducer } from "./mvp15d-final-live-producer-helper.mjs";

const PHASE = "product-capture";

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await liveProducerMain(PHASE);
}

export function runProductCaptureProducer(argv, options) {
  return runLiveProducer(PHASE, argv, options);
}
