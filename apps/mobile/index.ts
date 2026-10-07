/**
 * App entry point.
 *
 * The background location task is registered here, at module scope, *before*
 * the UI. Android can start this JS context headlessly (app swiped away,
 * phone locked) just to deliver a location batch, and the task must already be
 * defined when that happens.
 */
import "./src/ride/locationTask";

import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
